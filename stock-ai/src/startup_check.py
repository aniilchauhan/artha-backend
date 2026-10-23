"""
Startup artifact check for Axion.
Exits with code 0 if required model artifacts exist and appear valid.
Exits with code 1 with a clear message if artifacts are missing or stale,
so the Next.js python-runner can surface a helpful 503 rather than a hard crash.
"""

import sys
import os
import json
from pathlib import Path
from datetime import datetime, timezone

BASE_DIR = Path(__file__).resolve().parent.parent
MODELS_DIR = BASE_DIR / "models"
OUTPUTS_DIR = BASE_DIR / "outputs"

REQUIRED_ARTIFACTS = [
    MODELS_DIR / "lightgbm_stock_model.pkl",
    MODELS_DIR / "lightgbm_calibrated.pkl",
    MODELS_DIR / "model_metadata.json",
]

OPTIONAL_OUTPUTS = [
    OUTPUTS_DIR / "latest_predictions.json",
    OUTPUTS_DIR / "backtest_summary.json",
]

# Artifacts older than 90 days are considered stale (warn, not fail)
STALE_DAYS = 90


def check() -> dict:
    missing = []
    stale = []
    found = []
    now = datetime.now(timezone.utc).timestamp()

    for path in REQUIRED_ARTIFACTS:
        if not path.exists():
            missing.append(str(path.relative_to(BASE_DIR)))
        else:
            age_days = (now - path.stat().st_mtime) / 86400
            if age_days > STALE_DAYS:
                stale.append({"file": str(path.relative_to(BASE_DIR)), "age_days": round(age_days, 1)})
            found.append(str(path.relative_to(BASE_DIR)))

    output_status = {}
    for path in OPTIONAL_OUTPUTS:
        output_status[str(path.relative_to(BASE_DIR))] = path.exists()

    # Check provenance status — prefer model_metadata.json, fall back to config.py
    provenance_status = "unknown"
    metadata_path = MODELS_DIR / "model_metadata.json"
    if metadata_path.exists():
        try:
            with open(metadata_path) as f:
                meta = json.load(f)
            provenance_status = meta.get("provenance_status", meta.get("MODEL_PROVENANCE_STATUS", "unknown"))
        except Exception:
            provenance_status = "unreadable"

    if provenance_status == "unknown":
        # Fall back to config.py constant when metadata doesn't carry the field
        try:
            import importlib.util
            config_path = BASE_DIR / "config.py"
            spec = importlib.util.spec_from_file_location("config", config_path)
            cfg = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cfg)
            provenance_status = getattr(cfg, "MODEL_PROVENANCE_STATUS", "unknown")
        except Exception:
            pass

    return {
        "ready": len(missing) == 0,
        "missing": missing,
        "stale": stale,
        "found": found,
        "outputs": output_status,
        "provenance_status": provenance_status,
    }


if __name__ == "__main__":
    result = check()
    print(json.dumps(result, indent=2))

    if not result["ready"]:
        print(
            "\n[STARTUP CHECK FAILED] Required model artifacts are missing.\n"
            "Run `stock-ai/src/train.py` and `stock-ai/src/calibrate.py` to generate them.\n"
            f"Missing: {', '.join(result['missing'])}",
            file=sys.stderr,
        )
        sys.exit(1)

    if result["stale"]:
        for item in result["stale"]:
            print(
                f"[STARTUP CHECK WARNING] {item['file']} is {item['age_days']} days old — consider retraining.",
                file=sys.stderr,
            )

    if result["provenance_status"] == "REQUIRES_REGENERATION":
        print(
            "[STARTUP CHECK WARNING] model_metadata.json indicates MODEL_PROVENANCE_STATUS=REQUIRES_REGENERATION. "
            "Predictions served from these artifacts have unverified provenance.",
            file=sys.stderr,
        )

    sys.exit(0)
