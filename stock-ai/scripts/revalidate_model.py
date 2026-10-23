"""Build an isolated, reproducible core50 candidate from locally cached historical bars.

Never replaces the serving model. Run with AXION_MODEL_RUN_DIR set to a new directory.
"""
import hashlib
import json
import os
import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import config


STRATEGY_VARIANTS = [
    ('Baseline: Next Open + Fixed Stop', 'open', 'fixed', 1.2),
    ('MOC Entry + Fixed Stop', 'moc', 'fixed', 1.2),
    ('Next Open + ATR Stop', 'open', 'atr', 1.2),
    ('Breakout Entry + ATR Stop', 'breakout', 'atr', 1.2),
]

# Exploratory coverage grid. These cutoffs are compared on the existing,
# previously inspected test period; none is selected or promoted from it.
THRESHOLD_GRID = [round(value / 100, 2) for value in range(50, 75, 5)]


def evaluation_identity(provenance):
    """Bind reports to the fitted probabilities, preprocessing, and execution rules."""
    fields = (
        'model_sha256', 'dataset_sha256', 'calibrator_sha256',
        'simulator_sha256', 'configuration_sha256', 'target_version',
        'imputation_sha256',
    )
    return hashlib.sha256(json.dumps(
        {field: provenance[field] for field in fields}, sort_keys=True,
    ).encode()).hexdigest()[:24]


def evaluate_threshold_sweep(backtest, predictions, evaluation_id):
    """Compare signal coverage and capital-limited outcomes without choosing a winner."""
    rows = []
    for threshold in THRESHOLD_GRID:
        metrics, _ = backtest.simulate_realistic_trading(predictions, threshold=threshold)
        stressed, _ = backtest.simulate_realistic_trading(
            predictions,
            threshold=threshold,
            transaction_cost=config.TRANSACTION_COST_PCT * 2,
            slippage=config.SLIPPAGE_PCT * 2,
        )
        rows.append({
            'threshold': threshold,
            'candidate_signals': int((predictions['model_prob'] >= threshold).sum()),
            'active_signal_sessions': int(predictions.loc[predictions['model_prob'] >= threshold, 'Date'].nunique()),
            'selected_positions': metrics.get('portfolio_trade_count', 0),
            'active_portfolio_sessions': metrics.get('portfolio_active_sessions', 0),
            'target_hits': metrics.get('position_target_hits', 0),
            'target_hit_rate': metrics.get('position_target_hit_rate', 0),
            'portfolio_return': metrics.get('cumulative_return', 0),
            'stressed_portfolio_return': stressed.get('cumulative_return', 0),
            'max_drawdown': metrics.get('portfolio_max_drawdown', 0),
            'stressed_max_drawdown': stressed.get('portfolio_max_drawdown', 0),
            'evaluation_id': evaluation_id,
        })
    return rows


def build_session_diagnostics(predictions, thresholds):
    """Show whether inactive dates lacked rows or simply fell below cutoffs."""
    diagnostics = []
    for date, session in predictions.groupby('Date', sort=True):
        scores = session['model_prob']
        diagnostics.append({
            'date': date.strftime('%Y-%m-%d'),
            'scored_tickers': int(session['ticker'].nunique()),
            'highest_score': float(scores.max()) if not scores.empty else None,
            'signals_by_threshold': {
                f'{threshold:.2f}': int((scores >= threshold).sum())
                for threshold in thresholds
            },
        })
    return diagnostics


def evaluate_trade_strategies(backtest, predictions, evaluation_id):
    """Compare execution variants on the same clean-model test predictions."""
    comparisons = []
    for name, entry_mode, stop_loss_type, atr_multiplier in STRATEGY_VARIANTS:
        metrics, _ = backtest.simulate_realistic_trading(
            predictions,
            threshold=.60,
            entry_mode=entry_mode,
            stop_loss_type=stop_loss_type,
            atr_multiplier=atr_multiplier,
        )
        comparisons.append({
            'Strategy Name': name,
            'Trades': metrics.get('total_trades', 0),
            'Portfolio Positions': metrics.get('portfolio_trade_count', 0),
            'Win Rate': f"{metrics.get('win_rate', 0) * 100:.1f}%",
            'Target Exit Rate': f"{metrics.get('position_target_hit_rate', 0) * 100:.1f}%",
            'Avg Net Return / Candidate': f"{metrics.get('avg_return_per_trade', 0) * 100:.2f}%",
            'Portfolio Return': f"{metrics.get('cumulative_return', 0) * 100:.2f}%",
            'Portfolio CAGR': None if metrics.get('portfolio_cagr') is None else f"{metrics['portfolio_cagr'] * 100:.2f}%",
            'Max Drawdown': f"{metrics.get('portfolio_max_drawdown', 0) * 100:.2f}%",
            'Profit Factor': f"{metrics.get('profit_factor', 0):.2f}",
            'evaluation_id': evaluation_id,
            'raw_metrics': metrics,
        })
    return comparisons


def build_promotion_gate(base_metrics, stressed_metrics, fresh_blind_holdout=False):
    """Require adequate prospective evidence and portfolio-level risk limits."""
    checks = {
        'minimum_sessions_met': base_metrics.get('portfolio_active_sessions', 0) >= config.BACKTEST_MIN_SESSIONS_FOR_PROMOTION,
        'minimum_closed_positions_met': base_metrics.get('portfolio_trade_count', 0) >= config.BACKTEST_MIN_TRADES_FOR_PROMOTION,
        'positive_portfolio_return': base_metrics.get('cumulative_return', 0) > 0,
        'positive_stressed_portfolio_return': stressed_metrics.get('cumulative_return', 0) > 0,
        'drawdown_within_limit': base_metrics.get('portfolio_max_drawdown', 1) >= -config.BACKTEST_MAX_DRAWDOWN_FOR_PROMOTION,
        'stressed_drawdown_within_limit': stressed_metrics.get('portfolio_max_drawdown', 1) >= -config.BACKTEST_MAX_DRAWDOWN_FOR_PROMOTION,
        'fresh_blind_holdout': fresh_blind_holdout,
    }
    return {
        'criteria': {
            'minimum_sessions': config.BACKTEST_MIN_SESSIONS_FOR_PROMOTION,
            'minimum_closed_positions': config.BACKTEST_MIN_TRADES_FOR_PROMOTION,
            'maximum_drawdown_pct': config.BACKTEST_MAX_DRAWDOWN_FOR_PROMOTION * 100,
            'fresh_blind_holdout_required': True,
        },
        'checks': checks,
        'eligible_for_promotion': all(checks.values()),
        'status': 'ELIGIBLE' if all(checks.values()) else 'OBSERVATION_ONLY',
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--universe', choices=['core50', 'nifty100', 'nifty500', 'all'], default='core50')
    parser.add_argument('--clean', action='store_true', help='Exclude synthetic sentiment and FII/DII features')
    parser.add_argument('--resume', action='store_true', help='Evaluate an existing isolated candidate without retraining')
    parser.add_argument('--skip-latest-scan', action='store_true', help='Do not fetch or generate current live predictions after evaluation')
    parser.add_argument('--threshold-sweep-only', action='store_true', help='Add an exploratory cutoff comparison using the existing calibrated candidate and saved evaluation')
    args = parser.parse_args()
    if not os.environ.get('AXION_MODEL_RUN_DIR'):
        raise RuntimeError('Set AXION_MODEL_RUN_DIR to an isolated candidate directory')
    if args.clean:
        config.USE_SYNTHETIC_FEATURES = False
    if args.threshold_sweep_only and not args.resume:
        raise RuntimeError('--threshold-sweep-only requires --resume to use an existing isolated candidate')
    if config.MODEL_FILE.exists() and not args.resume:
        raise RuntimeError('Candidate exists; use --resume to finish evaluation without retraining')
    from src import dataset, train, calibrate, evaluate, backtest, predict
    candidate_universe = args.universe
    if args.resume:
        metadata = json.loads(config.METADATA_FILE.read_text())
        config.USE_SYNTHETIC_FEATURES = metadata.get('synthetic_features', config.USE_SYNTHETIC_FEATURES)
        candidate_universe = metadata.get('universe', args.universe)
        columns = metadata['features']
        if metadata.get('target_version') != config.TARGET_VERSION:
            raise RuntimeError('Cannot resume an incompatible candidate')
        if not args.threshold_sweep_only:
            # Reject incompatible legacy models before loading data or changing artifacts.
            calibrate.validate_calibration_contract(metadata)
        combined = dataset.load_combined_dataset()
        if args.threshold_sweep_only:
            # Reproduce legacy diagnostics using the model's recorded preprocessing
            # dates, rather than silently refitting imputation to today's config.
            train_df, val_df, test_df = dataset.get_chronological_splits(
                combined,
                train_start=metadata['train_start'], train_end=metadata['train_end'],
                val_start=metadata['val_start'], val_end=metadata['val_end'],
                apply_train_imputation=False,
            )
            imputation_path = config.MODELS_DIR / 'imputation_values.json'
            if not imputation_path.exists():
                raise RuntimeError('Saved training imputation is required to reproduce this candidate')
            saved_imputation = json.loads(imputation_path.read_text())
            test_df = dataset.apply_imputation(test_df, saved_imputation, columns)
        else:
            train_df, val_df, calibration_df, test_df = dataset.get_four_period_splits(combined)
    else:
        tickers = dataset.get_universe_tickers(args.universe)
        combined = dataset.build_combined_dataset(tickers=tickers, n_jobs=4)
        train_df, val_df, calibration_df, test_df = dataset.get_four_period_splits(combined)
        if any(frame.empty for frame in (train_df, val_df, calibration_df, test_df)):
            raise RuntimeError('Historical data must cover training, tuning, calibration, and evaluation periods')
        model, metadata, columns = train.train_model(train_df, val_df, params=config.LGBM_PARAMS.copy())
    if not args.threshold_sweep_only:
        # Retain the exact training-fitted medians used by inference and replay.
        imputation_values = dataset.compute_train_imputation_values(train_df, columns)
        (config.MODELS_DIR / 'imputation_values.json').write_text(json.dumps(imputation_values, indent=2))
        calibrated, calibration_report = calibrate.run_calibration()
    fingerprint = hashlib.sha256(config.MODEL_FILE.read_bytes()).hexdigest()
    dataset_fingerprint = hashlib.sha256(config.COMBINED_DATASET_PARQUET.read_bytes()).hexdigest()
    evaluation_id = hashlib.sha256(
        f"{fingerprint}:{dataset_fingerprint}:{combined['Date'].max().strftime('%Y-%m-%d')}:{config.TARGET_VERSION}".encode()
    ).hexdigest()[:24]
    provenance = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'target_version': config.TARGET_VERSION,
        'preprocessing_version': config.PREPROCESSING_VERSION,
        'model_sha256': fingerprint,
        'data_cutoff': combined['Date'].max().strftime('%Y-%m-%d'),
        'dataset_sha256': dataset_fingerprint,
        'evaluation_id': evaluation_id,
        'universe': candidate_universe,
        'synthetic_features': config.USE_SYNTHETIC_FEATURES,
        'evaluation_method': 'chronological_holdout',
        'limitations': ([
                'Historical sentiment and institutional flows include synthetic inputs.'
                ] if config.USE_SYNTHETIC_FEATURES else [
                'No synthetic sentiment or institutional-flow features were used.'
                ]) + [
                        ('Legacy calibration isolation is unverified; these diagnostics cannot select a live cutoff.'
                         if args.threshold_sweep_only else
                         'Training, tuning, and calibration use separate chronological partitions.'),
                        'Test period has been inspected previously; this is not a fresh blind holdout.',
                        'Daily bars use conservative stop-first resolution; execution costs are modeled.'],
    }
    if not args.threshold_sweep_only or metadata.get('calibrator_sha256'):
        provenance['calibration'] = (metadata.get('calibration') if args.threshold_sweep_only
                                     else calibration_report.get('calibration_provenance'))
        provenance['calibrator_sha256'] = hashlib.sha256(config.CALIBRATED_MODEL_FILE.read_bytes()).hexdigest()
        provenance['simulator_sha256'] = hashlib.sha256((config.BASE_DIR / 'src' / 'backtest.py').read_bytes()).hexdigest()
        provenance['configuration_sha256'] = hashlib.sha256((config.BASE_DIR / 'config.py').read_bytes()).hexdigest()
        provenance['imputation_sha256'] = hashlib.sha256((config.MODELS_DIR / 'imputation_values.json').read_bytes()).hexdigest()
        provenance['evaluation_id'] = evaluation_identity(provenance)
        evaluation_id = provenance['evaluation_id']
    if not args.threshold_sweep_only:
        metadata.update(provenance)
        config.METADATA_FILE.write_text(json.dumps(metadata, indent=2))
    if args.threshold_sweep_only:
        calibrated = calibrate.load_calibrated_model()
        oos = test_df.copy()
        oos['model_prob'] = calibrated.predict_proba(oos[columns].astype('float32'))[:, 1]
        summary_path = config.OUTPUTS_DIR / 'backtest_summary.json'
        if not summary_path.exists():
            raise RuntimeError('Existing backtest summary is required for --threshold-sweep-only')
        summary = json.loads(summary_path.read_text())
        if summary.get('evaluation_id') != evaluation_id:
            raise RuntimeError('Existing summary does not match this model and dataset; run full candidate evaluation first')
        threshold_sweep = evaluate_threshold_sweep(backtest, oos, evaluation_id)
        session_diagnostics = build_session_diagnostics(oos, THRESHOLD_GRID)
        summary.update({
            'threshold_sweep': threshold_sweep,
            'session_signal_diagnostics': session_diagnostics,
            'threshold_sweep_context': {
                'period': 'previously_inspected_test_period',
                'is_blind_holdout': False,
                'cutoffs_are_recommendations': False,
                'note': 'Legacy calibration isolation is unverified. Exploratory coverage and portfolio comparison only; train with separate tuning/calibration dates, select on development data, and verify once on a fresh holdout.',
            },
        })
        summary_path.write_text(json.dumps(summary, indent=2))
        (config.OUTPUTS_DIR / 'threshold_sweep.json').write_text(json.dumps({
            'evaluation_id': evaluation_id,
            'context': summary['threshold_sweep_context'],
            'threshold_sweep': threshold_sweep,
            'session_signal_diagnostics': session_diagnostics,
        }, indent=2))
        manifest_path = config.OUTPUTS_DIR / 'provenance.json'
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text())
            manifest['threshold_sweep_context'] = summary['threshold_sweep_context']
            manifest['artifacts'] = {
                file.name: hashlib.sha256(file.read_bytes()).hexdigest()
                for file in config.OUTPUTS_DIR.glob('*')
                if file.is_file() and file.name != manifest_path.name
            }
            manifest_path.write_text(json.dumps(manifest, indent=2))
        print(json.dumps({'evaluation_id': evaluation_id, 'threshold_sweep': threshold_sweep}, indent=2))
        return
    report = evaluate.run_full_evaluation()
    oos = test_df.copy()
    oos['model_prob'] = calibrated.predict_proba(oos[columns].astype('float32'))[:, 1]
    quality = backtest.simulate_signal_quality(oos, threshold=.60)
    quality['simulation'] = 'A (Close-to-Next-Day-High Target Touch; Signal Quality Only)'
    execution, trades = backtest.simulate_realistic_trading(oos, threshold=.60)
    stress_execution, _ = backtest.simulate_realistic_trading(
        oos,
        threshold=.60,
        transaction_cost=config.TRANSACTION_COST_PCT * 2,
        slippage=config.SLIPPAGE_PCT * 2,
    )
    comparisons = evaluate_trade_strategies(backtest, oos, evaluation_id)
    threshold_sweep = evaluate_threshold_sweep(backtest, oos, evaluation_id)
    session_diagnostics = build_session_diagnostics(oos, THRESHOLD_GRID)
    # Test data is known to have been inspected in previous candidate cycles.
    # It cannot pass a promotion gate even if its observed metrics look good.
    promotion_gate = build_promotion_gate(execution, stress_execution, fresh_blind_holdout=False)
    execution['promotion_gate'] = promotion_gate
    execution['stress_assumptions'] = {
        'transaction_cost_pct': config.TRANSACTION_COST_PCT * 2,
        'slippage_pct_per_side': config.SLIPPAGE_PCT * 2,
        'portfolio_return': stress_execution['cumulative_return'],
        'portfolio_max_drawdown': stress_execution['portfolio_max_drawdown'],
    }
    summary = {
        'simulation_a': quality,
        'simulation_b': execution,
        'stress_simulation': stress_execution,
        'strategy_comparison': comparisons,
        'threshold_sweep': threshold_sweep,
        'session_signal_diagnostics': session_diagnostics,
        'threshold_sweep_context': {
            'period': 'previously_inspected_test_period',
            'is_blind_holdout': False,
            'cutoffs_are_recommendations': False,
            'note': 'Exploratory coverage and portfolio comparison only. Do not select a cutoff from this inspected period; select on development data and verify once on a fresh holdout.',
        },
        'promotion_gate': promotion_gate,
        'evaluation_id': evaluation_id,
        'prediction_calendar': {
            'first_session': test_df['Date'].min().strftime('%Y-%m-%d') if not test_df.empty else None,
            'last_session': test_df['Date'].max().strftime('%Y-%m-%d') if not test_df.empty else None,
            'sessions': int(test_df['Date'].nunique()),
            'active_signal_sessions': int(oos.loc[oos['model_prob'] >= .60, 'Date'].nunique()),
            'active_portfolio_sessions': execution['portfolio_active_sessions'],
            'candidate_signals_at_threshold': quality['total_signals'],
        },
        'provenance': provenance,
    }
    trades['evaluation_id'] = evaluation_id
    (config.OUTPUTS_DIR / 'backtest_summary.json').write_text(json.dumps(summary, indent=2))
    trades.to_csv(config.OUTPUTS_DIR / 'backtest_trades.csv', index=False)
    (config.OUTPUTS_DIR / 'trades_sample.json').write_text(
        trades.tail(100).to_json(orient='records', date_format='iso')
    )
    (config.OUTPUTS_DIR / 'strategy_comparison.json').write_text(json.dumps(comparisons, indent=2))
    report['provenance'] = provenance
    (config.OUTPUTS_DIR / 'evaluation_report.json').write_text(json.dumps(report, indent=2))
    if not args.skip_latest_scan:
        predict.scan_latest_universe(include_live_sentiment=False, record_ledger=False)
    artifact_hashes = {}
    for file in config.OUTPUTS_DIR.glob('*'):
        if file.is_file() and file.name != 'provenance.json':
            artifact_hashes[file.name] = hashlib.sha256(file.read_bytes()).hexdigest()
    manifest = {**provenance, 'artifacts': artifact_hashes, 'status': 'candidate_evaluated'}
    (config.OUTPUTS_DIR / 'provenance.json').write_text(json.dumps(manifest, indent=2))
    print(json.dumps({'candidate': str(config.MODELS_DIR.parent), 'evaluation': report}, indent=2))


if __name__ == '__main__':
    main()
