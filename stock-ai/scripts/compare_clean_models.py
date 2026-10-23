"""Prepare/run/resume an isolated historical comparison. Never writes serving artifacts."""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
from datetime import datetime, timedelta, timezone

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf-8")
    temporary.replace(path)


def code_fingerprint():
    names = ["config.py", "src/features.py", "src/clean_contract.py", "src/clean_research_data.py",
             "src/clean_comparison.py", "src/calibrate.py", "scripts/compare_clean_models.py", "strategy/clean_comparison_v1.json"]
    return {name: sha256(BASE / name) for name in names}


def runtime_versions():
    return {name: importlib.metadata.version(name) for name in ("numpy", "pandas", "scikit-learn", "lightgbm", "ta", "joblib", "pyarrow")}


def serving_fingerprint():
    files = [file for folder in (BASE / "models", BASE / "outputs") for file in folder.glob("*")
             if file.is_file() and file.suffix in {".pkl", ".json"}]
    return {str(file.relative_to(BASE)): sha256(file) for file in files}


def validate_run_path(path):
    root = Path(path).resolve()
    runs = BASE / "runs"
    if not runs.resolve().is_relative_to(BASE.resolve()) or not root.is_relative_to(runs.resolve()) or root == runs.resolve():
        raise ValueError("Run directory must be a new child of stock-ai/runs")
    return root


def verify_resume(root, manifest):
    if manifest["code"] != code_fingerprint() or manifest["runtime"] != runtime_versions():
        raise ValueError("Cannot resume with changed code/runtime; create a new run")
    for relative, expected in manifest["artifacts"].items():
        target = (root / relative).resolve()
        if not target.is_relative_to(root) or not target.is_file() or sha256(target) != expected:
            raise ValueError(f"Resume artifact mismatch: {relative}")
    if manifest["contract"] != json.loads((root / "contract.json").read_text()):
        raise ValueError("Resume contract mismatch")


def snapshot_file(source, destination):
    content = source.read_bytes()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(content)
    return {"source_path": str(source), "snapshot_path": str(destination),
            "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content),
            "original_retrieved_at": None, "adjustment_convention": "unverified_cached_yfinance_ohlcv",
            "source_identity": "local download cache; original provider response not retained"}


def prepare(root, cutoff):
    import pandas as pd
    import config
    from src.clean_research_data import audit_bars, build_clean_frame, make_fold_manifest
    contract = json.loads((BASE / "strategy/clean_comparison_v1.json").read_text())
    contract["universe_members"] = list(config.STOCK_UNIVERSE)
    contract["requested_cutoff"] = cutoff
    write_json(root / "contract.json", contract)
    manifest = {"created_at": datetime.now(timezone.utc).isoformat(), "status": "preparing", "contract": contract,
                "code": code_fingerprint(), "runtime": runtime_versions(), "serving_before": serving_fingerprint(),
                "artifacts": {}, "completed_folds": [], "eligible_for_promotion": False}
    write_json(root / "manifest.json", manifest)
    audit = {"sources": {}, "stocks": {}, "limitations": contract["limitations"], "independent_source_check": "not_available"}
    try:
        source = BASE / "data/market/NSEI.csv"
        snapshot = root / "snapshot/market/NSEI.csv"
        audit["sources"]["^NSEI"] = snapshot_file(source, snapshot)
        benchmark, audit["benchmark"] = audit_bars(pd.read_csv(snapshot), cutoff, benchmark=True)
        if len(benchmark) < 1000:
            raise ValueError("Insufficient benchmark session history")
        effective_cutoff = benchmark.Date.max().strftime("%Y-%m-%d")
        all_frames = []
        for ticker in contract["universe_members"]:
            filename = ticker.replace(".", "_") + ".csv"
            try:
                source = BASE / "data/raw" / filename
                snapshot = root / "snapshot/raw" / filename
                audit["sources"][ticker] = snapshot_file(source, snapshot)
                stock, details = audit_bars(pd.read_csv(snapshot), effective_cutoff)
                details["missing_benchmark_sessions"] = int((~benchmark.Date.between(stock.Date.min(), stock.Date.max()) |
                    benchmark.Date.isin(stock.Date)).eq(False).sum()) if len(stock) else len(benchmark)
                details["stock_sessions_absent_from_benchmark"] = int((~stock.Date.isin(benchmark.Date)).sum())
                frame = build_clean_frame(stock, benchmark, ticker, contract)
                if len(frame) < 500:
                    raise ValueError("Insufficient contiguous stock history after exclusions")
                details.update({"status": "included", "usable_samples": len(frame), "last_usable_reference": str(frame.Date.max().date())})
                audit["stocks"][ticker] = details
                all_frames.append(frame)
            except (ValueError, OSError, KeyError) as error:
                audit["stocks"][ticker] = {"status": "excluded", "reason": str(error)}
        if len(all_frames) < 10:
            raise ValueError("Fewer than 10 stocks pass the clean data audit")
        combined = pd.concat(all_frames).sort_values(["Date", "ticker"]).reset_index(drop=True)
        folds = make_fold_manifest(benchmark.Date, contract)
        audit.update({"included_stocks": len(all_frames), "rows": len(combined), "effective_data_cutoff": effective_cutoff,
                      "last_prediction_reference": str(combined.Date.max().date()), "synthetic_features": False,
                      "cutoff_note": "Only cached benchmark-aligned sessions on/before the requested completed-day cutoff; historical research only."})
        combined.to_parquet(root / "dataset.parquet", index=False)
        write_json(root / "folds.json", folds)
        write_json(root / "data_audit.json", audit)
        manifest.update({"status": "prepared", "effective_data_cutoff": effective_cutoff, "folds": folds})
        manifest["artifacts"] = {str(file.relative_to(root)): sha256(file) for file in root.rglob("*")
                                 if file.is_file() and file.name != "manifest.json"}
        write_json(root / "manifest.json", manifest)
        return manifest
    except Exception as error:
        write_json(root / "data_audit.json", audit)
        manifest.update({"status": "data_blocked", "failure": str(error)})
        write_json(root / "manifest.json", manifest)
        raise


def markdown_report(root, manifest, results):
    audit = json.loads((root / "data_audit.json").read_text())
    lines = ["# Clean model historical comparison", "", "Research only. No serving model was replaced.", "",
             f"Data through {manifest['effective_data_cutoff']}; {audit['included_stocks']} stocks; {audit['rows']:,} usable samples.",
             "", "| Fold | Model | Ranked precision | Coverage | Mean net return | Brier score | Policy trades |", "|---|---|---:|---:|---:|---:|---:|"]
    for result in results:
        for name, metrics in result["models"].items():
            rank = metrics["matched_coverage"]
            lines.append(f"| {result['fold']['id']} | {name} | {rank['precision']:.2%} | {rank['coverage']:.2%} | {rank['mean_net_return']:.3%} | {metrics['probability_metrics']['brier_score']:.4f} | {metrics['frozen_policy']['count']} |")
    lines += ["", "Ranked selections compare equal daily coverage, including deterministic ticker tie-breaking. They are not recommendations.",
              "Policy trades use thresholds frozen on the policy partition and may be zero. Net returns use the contract's assumed costs.",
              "", "## Limits", ""] + [f"- {line}" for line in manifest["contract"]["limitations"]]
    lines += ["", "- Probability calibration, interval estimates, fold boundaries, exclusions and full predictions are in the adjacent JSON/Parquet files.",
              "- Capital metrics assume fractional shares; actual whole-share execution, broker fees and independent price verification remain unvalidated.",
              "- Future observation and separately timestamped official/news/social comparisons remain required before any accuracy-improvement claim."]
    (root / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--cutoff", help="Last completed date to admit; defaults to yesterday in India")
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    root = validate_run_path(args.run_dir)
    yesterday = (datetime.now(timezone(timedelta(hours=5, minutes=30))).date() - timedelta(days=1)).isoformat()
    cutoff = args.cutoff or yesterday
    if datetime.strptime(cutoff, "%Y-%m-%d").date().isoformat() > yesterday:
        raise ValueError("Cutoff must be before today's potentially incomplete session")
    if not args.resume:
        if root.exists():
            raise ValueError("Run directory already exists; use --resume or choose a new directory")
        root.mkdir(parents=True)
    elif not (root / "manifest.json").is_file():
        raise ValueError("No prepared manifest to resume")
    # Set isolation before importing modules that load config.py.
    os.environ["AXION_MODEL_RUN_DIR"] = str(root)
    os.environ["AXION_CLEAN_FEATURES"] = "1"
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    import pandas as pd
    from src.clean_comparison import run_fold
    if args.resume:
        manifest = json.loads((root / "manifest.json").read_text())
        verify_resume(root, manifest)
        if args.cutoff and cutoff != manifest["contract"]["requested_cutoff"]:
            raise ValueError("Resume cutoff differs from frozen contract")
        if manifest["status"] not in {"prepared", "running", "evaluation_failed", "complete"}:
            raise ValueError("Run did not finish preparation; use a new directory")
    else:
        manifest = prepare(root, cutoff)
    if args.prepare_only or manifest["status"] == "complete":
        print(json.dumps({"run": str(root), "status": manifest["status"]}))
        return
    frame = pd.read_parquet(root / "dataset.parquet")
    results = []
    manifest["status"] = "running"
    write_json(root / "manifest.json", manifest)
    try:
        for fold in manifest["folds"]:
            directory = root / fold["id"]
            if fold["id"] in manifest["completed_folds"]:
                result = json.loads((directory / "report.json").read_text())
            else:
                print(f"Evaluating {fold['id']} ...", flush=True)
                result = run_fold(frame, fold, manifest["contract"], directory)
                manifest["completed_folds"].append(fold["id"])
                manifest["artifacts"].update({str(file.relative_to(root)): sha256(file) for file in directory.iterdir() if file.is_file()})
                write_json(root / "manifest.json", manifest)
            results.append(result)
        if serving_fingerprint() != manifest["serving_before"]:
            raise ValueError("Serving artifacts changed during research; investigate before accepting this run")
        markdown_report(root, manifest, results)
        manifest["artifacts"]["REPORT.md"] = sha256(root / "REPORT.md")
        manifest.update({"status": "complete", "serving_unchanged": True, "completed_at": datetime.now(timezone.utc).isoformat()})
        manifest.pop("failure", None)
        write_json(root / "manifest.json", manifest)
        print(json.dumps({"run": str(root), "status": "complete", "report": str(root / "REPORT.md"), "eligible_for_promotion": False}))
    except Exception as error:
        manifest.update({"status": "evaluation_failed", "failure": str(error)})
        write_json(root / "manifest.json", manifest)
        raise


if __name__ == "__main__":
    main()
