"""Development-only selection with whole shares and explicit abstention.

Extends a completed clean comparison in an isolated research directory. Evaluation
results never choose a model, threshold or portfolio size.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", required=True)
    args = parser.parse_args()
    root = Path(args.run_dir).resolve()
    if not root.is_relative_to(BASE / "runs"):
        raise ValueError("Expected an isolated clean research run")
    os.environ["AXION_MODEL_RUN_DIR"] = str(root)
    os.environ["AXION_CLEAN_FEATURES"] = "1"
    import joblib
    import numpy as np
    import pandas as pd
    from lightgbm import LGBMRegressor, early_stopping
    from src.backtest import simulate_capital_limited_portfolio
    from src.clean_contract import PRICE_FEATURES, MARKET_FEATURES
    from src.clean_research_data import clean_matrix, fit_clean_medians, partition_frame
    from scripts.compare_clean_models import serving_fingerprint

    manifest = json.loads((root / "manifest.json").read_text())
    if manifest["status"] != "complete":
        raise ValueError("Complete the clean comparison first")
    for relative, expected in manifest["artifacts"].items():
        if hashlib.sha256((root / relative).read_bytes()).hexdigest() != expected:
            raise ValueError(f"Research artifact changed: {relative}")
    serving_before = serving_fingerprint()
    contract = manifest["contract"]
    frame = pd.read_parquet(root / "dataset.parquet")
    # Recover next-session entry prices from the exact audited source snapshots.
    opens = []
    for ticker in contract["universe_members"]:
        file = root / "snapshot/raw" / (ticker.replace(".", "_") + ".csv")
        raw = pd.read_csv(file, usecols=["Date", "Open"])
        raw["outcome_end"] = pd.to_datetime(raw.pop("Date"))
        raw["ticker"] = ticker
        opens.append(raw.rename(columns={"Open": "raw_open"}))
    frame = frame.merge(pd.concat(opens), on=["ticker", "outcome_end"], how="left", validate="many_to_one")
    assert frame.raw_open.notna().all() and frame.raw_open.gt(0).all()
    out = root / "portfolio_50k"
    out.mkdir(exist_ok=False)
    research_contract = {
        "initial_capital_inr": 50000, "position_counts": [3, 4, 5],
        "policy_quantiles": [0.5, 0.7, 0.9], "min_development_trades_each_size": 50,
        "eligibility": "Positive stressed portfolio P&L at all three sizes, at least 50 executed trades each; ties by model name then threshold.",
        "nomination": "Highest mean stressed development return across sizes; no nomination means cash.",
        "regression": "Predict executable net return; tune iterations on early_stop; offset predictions by mean residual on separate calibration block.",
        "trend_variant": "Same return regressor, allow entries only when signal-day Nifty is above its trailing SMA50.",
        "evaluation_use": "Reporting only; never picks model, threshold or position count.",
        "novelty": "Historical periods are previously inspected. Recent tail after 2026-09-10 is a temporal extension, not certified blind or prospective evidence.",
        "costs": {key: contract[key] for key in ("roundtrip_fee", "slippage_per_side", "cost_stress_multiplier")}}
    write_json(out / "contract.json", research_contract)

    def score(bundle, block):
        matrix = clean_matrix(block, bundle["features"], bundle["medians"])
        if bundle.get("return_regression"):
            return bundle["model"].predict(matrix) + bundle["offset"]
        return bundle["model"].predict_proba(matrix)[:, 1]

    def simulate(block, scores, slots, threshold=None, trend=False, stress=False, capital=50000):
        keep = np.ones(len(block), dtype=bool) if threshold is None else scores >= threshold
        if trend:
            keep &= block.nifty_trend.to_numpy() >= 0
        trades = block.loc[keep, ["Date", "ticker", "raw_open", "net_return", "stress_net_return"]].copy()
        trades["prob"] = scores[keep]
        trades["entry_price"] = trades.raw_open * (1 + contract["slippage_per_side"] * (contract["cost_stress_multiplier"] if stress else 1))
        if stress:
            trades["net_return"] = trades.stress_net_return
        portfolio = simulate_capital_limited_portfolio(trades, block.Date.unique().tolist(), capital, slots)
        curve = portfolio["curve"]
        selected = trades.loc[[(pd.Timestamp(d).normalize(), t) in portfolio["selected_keys"] for d, t in zip(trades.Date, trades.ticker)]].copy()
        selected["shares"] = [portfolio["selected_positions"][(pd.Timestamp(d).normalize(), t)]["shares"] for d, t in zip(selected.Date, selected.ticker)]
        selected["pnl_inr"] = [portfolio["selected_positions"][(pd.Timestamp(d).normalize(), t)]["notional_inr"] * r for d, t, r in zip(selected.Date, selected.ticker, selected.net_return)]
        final = float(curve.equity.iloc[-1])
        assert curve.positions.le(slots).all() and curve.exposure_fraction.le(1 + 1e-10).all()
        assert abs(capital + selected.pnl_inr.sum() - final) < 1e-6
        return {"stocks": slots, "final_value_inr": final, "return_pct": (final / capital - 1) * 100,
                "max_drawdown_pct": float(curve.drawdown.min()) * 100, "trades": len(selected),
                "active_sessions": int(curve.positions.gt(0).sum()), "sessions": len(curve)}, curve, selected

    summaries, diagnostics, histories = [], [], {n: [] for n in (3, 4, 5)}
    capitals = {n: 50000 for n in histories}
    last = None
    for fold in manifest["folds"]:
        print(f"Selecting development policies for {fold['id']} ...", flush=True)
        parts, partitions = partition_frame(frame, fold, contract)
        bundles = {file.stem: joblib.load(file) for file in (root / fold["id"]).glob("*.joblib")}
        columns = list(PRICE_FEATURES + MARKET_FEATURES)
        medians = fit_clean_medians(parts["fit"], columns)
        regressor = LGBMRegressor(**contract["lightgbm"])
        regressor.fit(clean_matrix(parts["fit"], columns, medians), parts["fit"].net_return,
                      eval_set=[(clean_matrix(parts["early_stop"], columns, medians), parts["early_stop"].net_return)],
                      callbacks=[early_stopping(25, verbose=False)])
        offset = float((parts["calibration"].net_return - regressor.predict(clean_matrix(parts["calibration"], columns, medians))).mean())
        return_bundle = {"model": regressor, "features": columns, "medians": medians, "offset": offset, "return_regression": True}
        bundles["expected_return"] = return_bundle
        bundles["expected_return_trend"] = {**return_bundle, "trend": True}
        policies = []
        for name, bundle in sorted(bundles.items()):
            scores = score(bundle, parts["policy"])
            for threshold in sorted(set(float(np.quantile(scores, q)) for q in research_contract["policy_quantiles"])):
                stats = [simulate(parts["policy"], scores, n, threshold, bundle.get("trend", False), True)[0] for n in histories]
                eligible = all(row["trades"] >= 50 and row["return_pct"] > 0 for row in stats)
                policies.append({"model": name, "threshold": threshold, "eligible": eligible, "development_stress": stats,
                                 "selection_score": float(np.mean([row["return_pct"] for row in stats]))})
        eligible = [row for row in policies if row["eligible"]]
        nominee = sorted(eligible, key=lambda row: (-row["selection_score"], row["model"], row["threshold"]))[0] if eligible else None
        frozen = {"fold": fold, "partitions": partitions, "trials": policies, "nominee": nominee, "status": "selected" if nominee else "abstain"}
        # Persist the policy and all fitted bundles before accessing evaluation outcomes.
        directory = out / fold["id"]
        directory.mkdir()
        write_json(directory / "frozen_policy.json", frozen)
        joblib.dump(bundles, directory / "research_models.joblib")
        evaluation = parts["evaluation"]
        for name, bundle in sorted(bundles.items()):
            scores = score(bundle, evaluation)
            for n in histories:
                stats, _, _ = simulate(evaluation, scores, n, trend=bundle.get("trend", False))
                diagnostics.append({"fold": fold["id"], "model": name, "mode": "ranked_diagnostic_no_profit_gate", **stats})
        for n in histories:
            bundle = bundles[nominee["model"]] if nominee else None
            scores = score(bundle, evaluation) if bundle else np.full(len(evaluation), -1.0)
            stats, curve, selected = simulate(evaluation, scores, n, nominee["threshold"] if nominee else 0,
                                              bundle.get("trend", False) if bundle else False, capital=capitals[n])
            curve.to_csv(directory / f"equity_{n}.csv", index=False)
            selected.to_csv(directory / f"trades_{n}.csv", index=False)
            histories[n].append(curve)
            capitals[n] = stats["final_value_inr"]
            summaries.append({"fold": fold["id"], "mode": frozen["status"], **stats})
        last = (fold, bundles, nominee)

    fold, bundles, nominee = last
    # Use the last development-frozen policy on later dates, without retuning it.
    for label, lower in (("historical_extension", "2026-07-15"), ("recent_extension", "2026-09-11")):
        block = frame.loc[frame.Date >= pd.Timestamp(lower)].reset_index(drop=True)
        if block.empty:
            continue
        for n in histories:
            bundle = bundles[nominee["model"]] if nominee else None
            scores = score(bundle, block) if bundle else np.full(len(block), -1.0)
            stats, curve, selected = simulate(block, scores, n, nominee["threshold"] if nominee else 0,
                                              bundle.get("trend", False) if bundle else False)
            curve.to_csv(out / f"{label}_equity_{n}.csv", index=False)
            selected.to_csv(out / f"{label}_trades_{n}.csv", index=False)
            summaries.append({"fold": label, "mode": "selected" if nominee else "abstain", "start": str(block.Date.min().date()), "end": str(block.Date.max().date()), **stats})
        if label == "recent_extension":
            for name, bundle in sorted(bundles.items()):
                scores = score(bundle, block)
                for n in histories:
                    stats, _, _ = simulate(block, scores, n, trend=bundle.get("trend", False))
                    diagnostics.append({"fold": label, "model": name, "mode": "ranked_diagnostic_no_profit_gate", **stats})

    pd.DataFrame(summaries).to_csv(out / "policy_portfolios.csv", index=False)
    pd.DataFrame(diagnostics).to_csv(out / "ranked_diagnostics.csv", index=False)
    combined = []
    for n, curves in histories.items():
        curve = pd.concat(curves, ignore_index=True)
        peak = np.maximum.accumulate(np.r_[50000, curve.equity.to_numpy()])[1:]
        combined.append({"stocks": n, "final_value_inr": capitals[n], "return_pct": (capitals[n] / 50000 - 1) * 100,
                         "max_drawdown_pct": float((curve.equity.to_numpy() / peak - 1).min()) * 100,
                         "active_sessions": int(curve.positions.gt(0).sum()), "sessions": len(curve)})
    assert serving_fingerprint() == serving_before
    result = {"contract": research_contract, "historical_portfolios": combined, "periods": summaries,
              "latest_nominee": nominee, "serving_unchanged": True, "eligible_for_promotion": False}
    write_json(out / "result.json", result)
    lines = ["# Stock-selection validation: INR 50,000", "", "Research only. Evaluation never chooses a strategy or position count.", "",
             "Eight candidates: frequency, technical momentum, two logistic models, two LightGBM classifiers, executable-return regression, and return regression with a Nifty trend filter.", "",
             "Training, early stopping, calibration, policy selection and evaluation occupy separate chronological blocks. Boundary outcomes are purged. Imputation uses training data only.", "",
             "Policies must earn positive stressed development P&L with at least 50 executed trades at each of 3, 4 and 5 positions. No eligible policy means cash. This is a research gate, not sufficient proof for deployment.", "",
             "## Development decisions", ""]
    for fold in manifest["folds"]:
        frozen = json.loads((out / fold["id"] / "frozen_policy.json").read_text())
        lines.append(f"- {fold['id']}: {frozen['status']}; {sum(row['eligible'] for row in frozen['trials'])} eligible trials out of {len(frozen['trials'])}.")
    lines += ["", "## Historical portfolio results", "", "| Stocks | Final INR | Return | Max drawdown | Active sessions / sessions |", "|---|---:|---:|---:|---:|"]
    for row in combined:
        lines.append(f"| {row['stocks']} | {row['final_value_inr']:.2f} | {row['return_pct']:.2f}% | {row['max_drawdown_pct']:.2f}% | {row['active_sessions']} / {row['sessions']} |")
    lines += ["", "## Limits", "", research_contract["novelty"], "",
              "Cash returns exclude interest and inflation; a zero return does not establish predictive skill. Whole shares, equity-based equal slots, idle unused slots and no leverage are modeled. Daily bars cannot establish fills or event ordering. Costs are assumptions, not broker-specific quotes.", ""]
    lines += [f"- {item}" for item in contract["limitations"]]
    lines += ["", "policy_portfolios.csv contains each evaluation and extension. ranked_diagnostics.csv shows forced-entry diagnostics; those results do not select a winner. Frozen policies and models are stored per fold."]
    (out / "REPORT.md").write_text("\n".join(lines), encoding="utf-8")
    files = {str(file.relative_to(out)): hashlib.sha256(file.read_bytes()).hexdigest() for file in out.rglob("*") if file.is_file()}
    write_json(out / "checksums.json", files)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
