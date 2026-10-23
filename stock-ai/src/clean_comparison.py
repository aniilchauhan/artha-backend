"""Bounded candidate comparison using explicit, disjoint chronological partitions."""
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier, early_stopping
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, log_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from src.calibrate import fit_explicit_calibrator
from src.clean_contract import PRICE_FEATURES, MARKET_FEATURES, FEATURE_VERSION
from src.clean_research_data import clean_matrix, fit_clean_medians, partition_frame


class ConstantModel:
    def __init__(self, probability):
        self.probability = probability

    def predict_proba(self, matrix):
        p = np.full(len(matrix), self.probability)
        return np.column_stack([1 - p, p])


class TechnicalModel:
    """Prespecified momentum/trend score, subsequently calibrated on its own block."""
    def predict_proba(self, matrix):
        score = (matrix["ret_5d"].to_numpy() + matrix["close_to_sma20"].to_numpy()) * 10
        p = 1 / (1 + np.exp(-np.clip(score, -30, 30)))
        return np.column_stack([1 - p, p])


def ranked_selection(frame, probabilities, contract, threshold=None):
    if len(probabilities) != len(frame) or not np.isfinite(probabilities).all():
        raise ValueError("Invalid selection probabilities")
    ranked = frame[["Date", "ticker"]].copy()
    ranked["score"] = probabilities
    ranked["row"] = np.arange(len(frame))
    ranked = ranked.sort_values(["Date", "score", "ticker"], ascending=[True, False, True])
    counts = ranked.groupby("Date").score.transform("size")
    slots = np.minimum(contract["max_positions_per_day"], np.maximum(1, np.ceil(counts * contract["coverage_fraction"])))
    keep = ranked.groupby("Date").cumcount() < slots
    if threshold is not None:
        keep &= ranked.score >= threshold
    mask = np.zeros(len(frame), dtype=bool)
    mask[ranked.loc[keep, "row"].to_numpy()] = True
    return mask


def selection_stats(frame, mask, contract):
    selected = frame.loc[mask]
    daily = selected.groupby("Date").net_return.sum().reindex(sorted(frame.Date.unique()), fill_value=0) / contract["max_positions_per_day"]
    equity = np.r_[1.0, (1 + daily).cumprod().to_numpy()]
    drawdown = equity / np.maximum.accumulate(equity) - 1
    return {"count": len(selected), "coverage": float(len(selected) / len(frame)),
            "precision": float(selected.target.mean()) if len(selected) else None,
            "recall": float(selected.target.sum() / frame.target.sum()) if frame.target.sum() else None,
            "mean_net_return": float(selected.net_return.mean()) if len(selected) else None,
            "mean_stress_net_return": float(selected.stress_net_return.mean()) if len(selected) else None,
            "worst_trade": float(selected.net_return.min()) if len(selected) else None,
            "fractional_capital_return": float(equity[-1] - 1), "max_drawdown": float(drawdown.min()),
            "mean_daily_exposure": float(len(selected) / (len(daily) * contract["max_positions_per_day"])),
            "capital_assumption": "Each trade gets 1/max_positions of capital; unused slots are cash; fractional shares, no financing."}


def probability_stats(labels, probabilities):
    y = np.asarray(labels)
    p = np.asarray(probabilities)
    if not np.isfinite(p).all() or ((p < 0) | (p > 1)).any():
        raise ValueError("Invalid predicted probability")
    bins = []
    for index in range(10):
        mask = (p >= index / 10) & ((p < (index + 1) / 10) if index < 9 else (p <= 1))
        bins.append({"lower": index / 10, "upper": (index + 1) / 10, "count": int(mask.sum()),
                     "mean_probability": float(p[mask].mean()) if mask.any() else None,
                     "event_rate": float(y[mask].mean()) if mask.any() else None})
    return {"rows": len(y), "event_rate": float(y.mean()), "pr_auc": float(average_precision_score(y, p)),
            "roc_auc": float(roc_auc_score(y, p)), "brier_score": float(brier_score_loss(y, p)),
            "log_loss": float(log_loss(y, p, labels=[0, 1])), "calibration_bins": bins}


def choose_policy(frame, probabilities, contract):
    """A fixed three-quantile budget. Never receives evaluation observations."""
    trials = []
    for threshold in sorted(set(float(np.quantile(probabilities, q)) for q in contract["policy_quantiles"])):
        mask = ranked_selection(frame, probabilities, contract, threshold)
        stats = selection_stats(frame, mask, contract)
        trials.append({"threshold": threshold, **stats})
    eligible = [row for row in trials if row["count"] >= contract["min_policy_trades"] and row["mean_stress_net_return"] > 0]
    if not eligible:
        return {"status": "abstain", "threshold": None, "trials": trials,
                "reason": "No prespecified threshold met minimum sample size and positive stressed mean return on policy data."}
    best = max(eligible, key=lambda row: (row["fractional_capital_return"], row["threshold"]))
    return {"status": "selected", "threshold": best["threshold"], "trials": trials,
            "policy_stats": best, "reason": "Chosen on policy block only; eligibility is research, not production approval."}


def paired_intervals(frame, candidate_mask, baseline_mask, contract):
    """Paired moving blocks of session-level sufficient statistics, including cash days."""
    days = sorted(frame.Date.unique())
    arrays = []
    for mask in (candidate_mask, baseline_mask):
        selected = frame.loc[mask]
        grouped = selected.groupby("Date").agg(hits=("target", "sum"), count=("target", "size"), net=("net_return", "sum"))
        arrays.append(grouped.reindex(days, fill_value=0).to_numpy(dtype=float))
    rng = np.random.default_rng(contract["seed"])
    block = min(contract["bootstrap_block_sessions"], len(days))
    differences = []
    for _ in range(contract["bootstrap_repeats"]):
        starts = rng.integers(0, len(days) - block + 1, size=int(np.ceil(len(days) / block)))
        indices = np.concatenate([np.arange(start, start + block) for start in starts])[:len(days)]
        a, b = (values[indices].sum(axis=0) for values in arrays)
        if a[1] and b[1]:
            differences.append([a[0] / a[1] - b[0] / b[1], a[2] / a[1] - b[2] / b[1]])
    if not differences:
        return {"precision_difference_95pct": None, "mean_net_difference_95pct": None}
    bounds = np.quantile(differences, [0.025, 0.975], axis=0)
    return {"precision_difference_95pct": bounds[:, 0].tolist(), "mean_net_difference_95pct": bounds[:, 1].tolist(),
            "method": "paired_moving_session_blocks", "block_sessions": block, "replicates": len(differences)}


def run_fold(frame, fold, contract, output_dir):
    root = Path(output_dir)
    root.mkdir(parents=True, exist_ok=True)
    parts, partition_report = partition_frame(frame, fold, contract)
    specs = [("frequency", "price", ConstantModel(float(parts["fit"].target.mean()))),
             ("technical", "price", TechnicalModel())]
    for feature_set in ("price", "price_market"):
        specs.extend([(f"logistic_{feature_set}", feature_set, make_pipeline(StandardScaler(), LogisticRegression(max_iter=500, random_state=contract["seed"]))),
                      (f"lightgbm_{feature_set}", feature_set, LGBMClassifier(**contract["lightgbm"]))])
    frozen, policies, raw_models = {}, {}, {}
    for name, feature_set, model in specs:
        columns = list(PRICE_FEATURES + (MARKET_FEATURES if feature_set == "price_market" else ()))
        medians = fit_clean_medians(parts["fit"], columns)
        matrices = {key: clean_matrix(value, columns, medians) for key, value in parts.items() if key != "evaluation"}
        if name.startswith("lightgbm"):
            model.fit(matrices["fit"], parts["fit"].target,
                      eval_set=[(matrices["early_stop"], parts["early_stop"].target)], callbacks=[early_stopping(25, verbose=False)])
        elif name.startswith("logistic"):
            model.fit(matrices["fit"], parts["fit"].target)
        raw_models[name] = model
        calibrated = model if name == "frequency" else fit_explicit_calibrator(
            model, matrices["calibration"], parts["calibration"].target, contract["calibration_method"])
        policy = choose_policy(parts["policy"], calibrated.predict_proba(matrices["policy"])[:, 1], contract)
        bundle = {"model": calibrated, "features": columns, "medians": medians, "feature_version": FEATURE_VERSION,
                  "target_version": contract["target_version"], "policy": policy, "fold": fold, "synthetic_features": False,
                  "status": "research_only"}
        joblib.dump(bundle, root / f"{name}.joblib")
        frozen[name], policies[name] = bundle, policy
    # Persist policy decisions BEFORE reading evaluation predictions or metrics.
    nominees = [(name, policy["policy_stats"]["fractional_capital_return"]) for name, policy in policies.items()
                if name.startswith(("logistic", "lightgbm")) and policy["status"] == "selected"]
    nominee = max(nominees, key=lambda item: item[1])[0] if nominees else None
    (root / "frozen_policies.json").write_text(json.dumps({"policies": policies, "policy_only_nominee": nominee}, indent=2, allow_nan=False))
    evaluation = parts["evaluation"]
    predictions = evaluation[["Date", "ticker", "outcome_end", "target", "net_return", "stress_net_return", "exit_reason", "nifty_trend"]].copy()
    report = {"fold": fold, "partitions": partition_report, "policy_only_nominee": nominee, "models": {}}
    masks = {}
    for name, bundle in frozen.items():
        matrix = clean_matrix(evaluation, bundle["features"], bundle["medians"])
        probabilities = bundle["model"].predict_proba(matrix)[:, 1]
        raw = raw_models[name].predict_proba(matrix)[:, 1]
        mask = ranked_selection(evaluation, probabilities, contract)
        policy = policies[name]
        policy_mask = ranked_selection(evaluation, probabilities, contract, policy["threshold"]) if policy["status"] == "selected" else np.zeros(len(evaluation), dtype=bool)
        predictions[f"{name}_probability"] = probabilities
        predictions[f"{name}_ranked"] = mask
        predictions[f"{name}_policy"] = policy_mask
        masks[name] = mask
        regime = {}
        for label, condition in (("nifty_above_sma50", evaluation.nifty_trend >= 0), ("nifty_below_sma50", evaluation.nifty_trend < 0)):
            selected = evaluation.loc[mask & condition]
            regime[label] = {"count": len(selected), "precision": float(selected.target.mean()) if len(selected) else None}
        report["models"][name] = {"raw_probability_metrics": probability_stats(evaluation.target, raw),
                                  "probability_metrics": probability_stats(evaluation.target, probabilities),
                                  "matched_coverage": selection_stats(evaluation, mask, contract),
                                  "frozen_policy": selection_stats(evaluation, policy_mask, contract),
                                  "policy": policy, "regime": regime,
                                  "tied_score_rows": int(pd.DataFrame({"Date": evaluation.Date, "p": probabilities}).duplicated(["Date", "p"], keep=False).sum())}
    for name in frozen:
        report["models"][name]["versus_technical"] = paired_intervals(evaluation, masks[name], masks["technical"], contract)
    predictions.to_parquet(root / "predictions.parquet", index=False)
    (root / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False))
    return report
