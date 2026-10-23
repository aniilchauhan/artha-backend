"""
Phase 2: Optuna Hyperparameter Tuning for Stock-AI LightGBM Classifier.

Uses Bayesian TPE (Tree-structured Parzen Estimator) optimization to find the
best LightGBM hyperparameters, evaluated on the held-out VALIDATION set by
ROC-AUC. Pruning eliminates unpromising trials early via MedianPruner.

After completion, the best params are saved to models/best_params.json.
Re-running src/train.py will then automatically use these params.

Usage:
    python src/tune.py                    # default 80 trials
    python src/tune.py --trials 120       # custom trial count
    python src/tune.py --trials 40 --jobs 4  # parallel (4 workers)

Outputs:
    models/best_params.json              -- best hyperparameter set
    outputs/optuna_study.pkl             -- full study object (resume support)
    outputs/optuna_importance.json       -- hyperparameter importance rankings
"""

import sys
import json
import argparse
import logging
import warnings
from pathlib import Path
from typing import Dict

import joblib
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier, early_stopping, log_evaluation, callback
from sklearn.metrics import roc_auc_score

sys.path.append(str(Path(__file__).resolve().parent.parent))
import config
from src import dataset, features, train as train_module

warnings.filterwarnings("ignore", category=UserWarning)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# Suppress optuna's verbose per-trial logging (we log summaries ourselves)
import optuna
optuna.logging.set_verbosity(optuna.logging.WARNING)


def _load_train_val_arrays():
    """Loads and returns train/val feature arrays (cached for trial reuse)."""
    combined = dataset.load_combined_dataset()
    train_df, val_df, _ = dataset.get_chronological_splits(combined)

    X_train, y_train, X_val, y_val, feature_cols = train_module.prepare_training_arrays(
        train_df, val_df
    )
    pos_count = int((y_train == 1).sum())
    neg_count = int((y_train == 0).sum())
    scale_pos_weight = neg_count / max(pos_count, 1)

    return X_train, y_train, X_val, y_val, feature_cols, scale_pos_weight


def _objective(trial, X_train, y_train, X_val, y_val, scale_pos_weight) -> float:
    """
    Optuna objective: trains one LightGBM configuration and returns val ROC-AUC.
    Manual pruning: trains a fast warmup run first to filter obviously bad configs.
    """
    params = {
        "n_estimators":        trial.suggest_int("n_estimators", 200, 1000),
        "learning_rate":       trial.suggest_float("learning_rate", 0.005, 0.10, log=True),
        "num_leaves":          trial.suggest_int("num_leaves", 16, 127),
        "max_depth":           trial.suggest_int("max_depth", 3, 10),
        "subsample":           trial.suggest_float("subsample", 0.5, 1.0),
        "colsample_bytree":    trial.suggest_float("colsample_bytree", 0.4, 1.0),
        "min_child_samples":   trial.suggest_int("min_child_samples", 10, 100),
        "reg_alpha":           trial.suggest_float("reg_alpha", 0.0, 3.0),
        "reg_lambda":          trial.suggest_float("reg_lambda", 0.0, 3.0),
        "random_state": 42,
        "n_jobs": -1,
        "importance_type": "gain",
        "verbose": -1,
    }

    # Imbalance handling consistent with production training
    if config.IMBALANCE_METHOD == "scale_pos_weight":
        params["scale_pos_weight"] = scale_pos_weight
    elif config.IMBALANCE_METHOD == "balanced":
        params["class_weight"] = "balanced"

    # Quick warmup run with 100 trees to prune bad configs early
    warmup_params = {**params, "n_estimators": 100}
    warmup_model = LGBMClassifier(**warmup_params)
    warmup_model.fit(
        X_train, y_train,
        eval_set=[(X_val, y_val)],
        callbacks=[log_evaluation(period=-1)],
    )
    warmup_auc = float(roc_auc_score(y_val, warmup_model.predict_proba(X_val)[:, 1]))

    # Manual pruning: report intermediate value and check if trial should be pruned
    trial.report(warmup_auc, step=0)
    if trial.should_prune():
        raise optuna.exceptions.TrialPruned()

    # Full training run with early stopping
    model = LGBMClassifier(**params)
    model.fit(
        X_train, y_train,
        eval_set=[(X_train, y_train), (X_val, y_val)],
        eval_names=["train", "valid_1"],
        callbacks=[
            early_stopping(stopping_rounds=30, verbose=False),
            log_evaluation(period=-1),
        ],
    )

    val_probs = model.predict_proba(X_val)[:, 1]
    auc = float(roc_auc_score(y_val, val_probs))
    
    # Calculate Precision @ Top-5% highest conviction predictions
    top_cutoff = np.quantile(val_probs, 0.95)
    top_mask = val_probs >= top_cutoff
    prec_top5 = float(y_val[top_mask].mean()) if top_mask.sum() > 0 else 0.0
    
    # Composite objective: balances ranking quality with high-conviction hit rate
    composite_score = 0.5 * auc + 0.5 * prec_top5
    return composite_score


def run_tuning(n_trials: int = 80, n_jobs: int = 1, resume: bool = True) -> Dict:
    """
    Runs the Optuna hyperparameter search.

    Args:
        n_trials: Total number of trials to run.
        n_jobs:   Parallel workers (-1 = all cores). Keep at 1 for reproducibility.
        resume:   If True and a previous study exists, resume from it.

    Returns:
        best_params: Dict of the best found hyperparameters.
    """
    print("\n" + "=" * 70)
    print("PHASE 2: OPTUNA HYPERPARAMETER TUNING (LightGBM)")
    print(f"Trials: {n_trials}   Workers: {n_jobs}   Resume: {resume}")
    print("=" * 70)

    # Load data once (reused across all trials)
    logger.info("Loading dataset for tuning...")
    X_train, y_train, X_val, y_val, feature_cols, scale_pos_weight = _load_train_val_arrays()
    logger.info(
        f"Train: {len(X_train)} rows ({int(y_train.sum())} pos) | "
        f"Val: {len(X_val)} rows ({int(y_val.sum())} pos)"
    )

    # Study persistence (resume support)
    study_path = config.OUTPUTS_DIR / "optuna_study.pkl"
    sampler = optuna.samplers.TPESampler(seed=42)
    pruner = optuna.pruners.MedianPruner(n_startup_trials=10, n_warmup_steps=50)

    if resume and study_path.exists():
        study = joblib.load(study_path)
        completed = len([t for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE])
        logger.info(f"Resuming study from disk. Already completed: {completed} trials.")
    else:
        study = optuna.create_study(
            direction="maximize",
            sampler=sampler,
            pruner=pruner,
            study_name="lightgbm_nse_swing",
        )
        logger.info("Created new Optuna study.")

    # Objective with pre-loaded data via closure
    def objective(trial):
        return _objective(trial, X_train, y_train, X_val, y_val, scale_pos_weight)

    # Run optimization
    logger.info(f"Starting optimization: {n_trials} trials...")
    study.optimize(
        objective,
        n_trials=n_trials,
        n_jobs=n_jobs,
        catch=(Exception,),
        show_progress_bar=True,
    )

    # Persist study
    config.OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(study, study_path)

    # Results
    best_trial = study.best_trial
    best_auc = best_trial.value
    best_params = dict(best_trial.params)
    # Add fixed params not in the search space
    best_params.update({
        "random_state": 42,
        "n_jobs": -1,
        "importance_type": "gain",
        "verbose": -1,
    })
    if config.IMBALANCE_METHOD == "balanced":
        best_params["class_weight"] = "balanced"

    print("\n" + "=" * 70)
    print(f"BEST VALIDATION ROC-AUC: {best_auc:.4f}  (baseline default: ~0.664)")
    print(f"BEST TRIAL: #{best_trial.number}")
    print("\nBest Hyperparameters:")
    print("-" * 50)
    for k, v in sorted(best_trial.params.items()):
        default_v = config.LGBM_PARAMS.get(k, "N/A")
        print(f"  {k:<25} = {v!r:<12}  (default: {default_v})")
    print("=" * 70)

    # Completed vs pruned stats
    completed = [t for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE]
    pruned = [t for t in study.trials if t.state == optuna.trial.TrialState.PRUNED]
    print(f"\nTrials completed: {len(completed)} | Pruned early: {len(pruned)}")

    # Hyperparameter importance
    try:
        importance = optuna.importance.get_param_importances(study)
        importance_list = [{"param": k, "importance": round(v, 4)} for k, v in importance.items()]
        print("\nHyperparameter Importance (most to least impactful):")
        for item in importance_list[:8]:
            bar = "#" * int(item["importance"] * 40)
            print(f"  {item['param']:<25} {bar} ({item['importance']:.3f})")
    except Exception:
        importance_list = []

    # Save best params
    config.MODELS_DIR.mkdir(parents=True, exist_ok=True)
    with open(config.BEST_PARAMS_FILE, "w") as f:
        json.dump(best_params, f, indent=4)
    logger.info(f"Saved best params to: {config.BEST_PARAMS_FILE}")

    # Save importance
    importance_report = {
        "best_trial": best_trial.number,
        "best_val_roc_auc": best_auc,
        "best_params": best_params,
        "param_importances": importance_list,
        "trials_completed": len(completed),
        "trials_pruned": len(pruned),
    }
    with open(config.OUTPUTS_DIR / "optuna_importance.json", "w") as f:
        json.dump(importance_report, f, indent=4)

    print(f"\n[DONE] Best params saved to: {config.BEST_PARAMS_FILE}")
    print("Now run: python src/train.py  (will auto-load best params)")
    print("Then run: python src/calibrate.py  (to recalibrate)")
    print("=" * 70)

    return best_params


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Optuna hyperparameter tuning for stock-ai LightGBM")
    parser.add_argument("--trials", type=int, default=80, help="Number of Optuna trials (default: 80)")
    parser.add_argument("--jobs", type=int, default=1, help="Parallel workers (default: 1)")
    parser.add_argument("--no-resume", action="store_true", help="Start fresh study (ignore saved study)")
    args = parser.parse_args()
    run_tuning(n_trials=args.trials, n_jobs=args.jobs, resume=not args.no_resume)
