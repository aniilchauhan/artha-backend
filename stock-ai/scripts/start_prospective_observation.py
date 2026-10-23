"""Start one immutable prospective prediction cohort from the latest verified artifact.

The intended NSE session must be supplied explicitly after checking the exchange calendar.
This script records predictions only; outcomes are added later by reconciliation.
"""
import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import config
from src import ledger


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Start an immutable prospective prediction cohort.")
    parser.add_argument("--intended-session", required=True, help="Verified future NSE session, YYYY-MM-DD")
    parser.add_argument("--model-run", default="serving", help="Frozen model run label")
    args = parser.parse_args()

    try:
        intended_session = datetime.strptime(args.intended_session, "%Y-%m-%d").date()
    except ValueError as exc:
        raise SystemExit("intended session must use YYYY-MM-DD") from exc

    prediction_file = config.OUTPUTS_DIR / "latest_predictions.json"
    if not prediction_file.exists():
        raise SystemExit(f"prediction artifact not found: {prediction_file}")

    predictions = json.loads(prediction_file.read_text(encoding="utf-8"))
    if not isinstance(predictions, list) or not predictions:
        raise SystemExit("prediction artifact is empty or invalid")

    provenance = json.loads((config.OUTPUTS_DIR / 'provenance.json').read_text(encoding='utf-8'))
    if (provenance.get('target_version') != config.TARGET_VERSION
            or provenance.get('artifacts', {}).get('latest_predictions.json') != sha256(prediction_file)):
        raise SystemExit('Prediction artifact provenance is incompatible or checksum does not match')

    input_dates = [datetime.strptime(str(row["Date"]), "%Y-%m-%d").date() for row in predictions]
    latest_input_date = max(input_dates)
    today = datetime.now(timezone(timedelta(hours=5, minutes=30))).date()
    if any((today - date).days < 0 or (today - date).days > 4 for date in input_dates):
        raise SystemExit('Prediction inputs are stale or future-dated; refresh market data first')
    error = ledger.prospective_prediction_error(dict(intended_session=args.intended_session,
        recorded_at=datetime.now(timezone.utc).isoformat(), input_cutoff=f'{latest_input_date}T15:30:00+05:30'))
    if error:
        raise SystemExit(error)
    if intended_session <= latest_input_date:
        raise SystemExit(
            f"intended session {intended_session} must be after latest input date {latest_input_date}"
        )

    model_hash = sha256(config.MODEL_FILE)
    calibrated_hash = sha256(config.CALIBRATED_MODEL_FILE)
    if (provenance.get('preprocessing_version') != '2.0-temporal-isolated'
            or provenance.get('model_sha256') != model_hash
            or provenance.get('calibrated_model_sha256') != calibrated_hash):
        raise SystemExit('Frozen inference model or calibrator does not match prediction provenance')
    if (provenance.get('preprocessing_version') != '2.0-temporal-isolated'
            or provenance.get('model_sha256') != model_hash
            or provenance.get('calibrated_model_sha256') != calibrated_hash):
        raise SystemExit('Frozen inference model or calibrator does not match prediction provenance')
    model_version = f"{args.model_run}:{model_hash[:16]}:{calibrated_hash[:16]}"
    existing = ledger.load_all_predictions()
    duplicate = [
        row for row in existing
        if row.get("intended_session") == args.intended_session
        and row.get("model_version") == model_version
    ]
    if duplicate:
        raise SystemExit("this model/session cohort has already been recorded")

    recorded_at = datetime.now(timezone.utc).isoformat()
    for row in predictions:
        reference_price = float(row["Close_Numeric"])
        if reference_price <= 0:
            continue
        ledger.record_prediction(
            ticker=str(row["Ticker"]),
            horizon="next",
            intended_session=args.intended_session,
            reference_price=reference_price,
            score=float(row["Model Score"]),
            calibrated_prob=float(row["Model Score"]),
            entry_condition="market_open",
            target_pct=config.TARGET_PCT,
            stop_pct=config.STOP_LOSS_PCT,
            target_version=config.TARGET_VERSION,
            model_version=model_version,
            input_cutoff=f"{row['Date']}T15:30:00+05:30",
            positive_drivers=row.get("positive_drivers", []),
            negative_drags=row.get("negative_drags", []),
        )

    manifest_dir = config.OUTPUTS_DIR / "prospective"
    manifest_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "cohort": "prospective",
        "intended_session": args.intended_session,
        "recorded_at": recorded_at,
        "model_version": model_version,
        "target_version": config.TARGET_VERSION,
        "latest_input_date": str(latest_input_date),
        "prediction_count": len(predictions),
        "prediction_artifact_sha256": sha256(prediction_file),
        "model_sha256": model_hash,
        "calibrated_model_sha256": calibrated_hash,
        "status": "pending_reconciliation",
    }
    manifest_path = manifest_dir / f"cohort_{args.intended_session}.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"manifest": str(manifest_path), **manifest}, indent=2))


if __name__ == "__main__":
    main()
