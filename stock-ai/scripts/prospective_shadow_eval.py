"""
Prospective Shadow Evaluation Engine & Report Generator (M6-05, M6-07).
Evaluates frozen model candidates on real forward shadow observations without lookahead.
Enforces the acceptance criterion:
'No model promotion based solely on historical ranking metrics.'
"""

import argparse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
import sys
import numpy as np

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

import config
from src import ledger
from src.drift_monitor import evaluate_prospective_calibration

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def run_prospective_shadow_evaluation() -> dict:
    """
    Loads all prospective predictions and outcomes from the ledger and generates
    an audited shadow evaluation report.
    """
    predictions, outcomes, excluded = ledger.validated_observations()

    outcomes_by_pred_id = {o["prediction_id"]: o for o in outcomes}

    total_predictions = len(predictions)
    reconciled_outcomes = []
    unresolved_count = 0

    probs = []
    targets_hit = []
    net_returns = []

    for pred in predictions:
        pred_id = pred["prediction_id"]
        out = outcomes_by_pred_id.get(pred_id)
        if not out:
            unresolved_count += 1
            continue

        reconciled_outcomes.append((pred, out))
        prob = float(pred.get("calibrated_prob", pred.get("raw_score", 0.5)))
        probs.append(prob)

        is_hit = 1.0 if out.get("outcome_status") == "TARGET_HIT" else 0.0
        targets_hit.append(is_hit)

        if out.get("net_return") is not None:
            net_returns.append(float(out["net_return"]))

    probs_arr = np.array(probs)
    targets_arr = np.array(targets_hit)

    # Calculate calibration
    calib_stats = evaluate_prospective_calibration(probs_arr, targets_arr)

    # Win rate and returns
    completed_count = len(reconciled_outcomes)
    overall_win_rate = float(np.mean(targets_arr)) if completed_count > 0 else 0.0
    avg_net_return = float(np.mean(net_returns)) if net_returns else 0.0

    # Decision on promotion
    promotion_eligible = (
        completed_count >= 30
        and len({(p.get('model_version'), p.get('target_version')) for p, _ in reconciled_outcomes}) == 1
        and calib_stats.get("ece") is not None
        and calib_stats["ece"] <= 0.05
        and overall_win_rate >= 0.55
    )

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "evaluation_protocol": "PROSPECTIVE_SHADOW_FROZEN",
        "acceptance_rule": "No model promotion based solely on historical ranking metrics",
        "sample_statistics": {
            "total_predictions": total_predictions,
            "excluded_invalid_predictions": excluded,
            "completed_observations": completed_count,
            "unresolved_pending": unresolved_count,
            "coverage_rate": round(completed_count / max(total_predictions, 1), 4),
        },
        "performance_metrics": {
            "overall_win_rate": round(overall_win_rate, 4),
            "high_confidence_win_rate": calib_stats.get("high_confidence_win_rate"),
            "high_confidence_samples": calib_stats.get("high_confidence_count", 0),
            "brier_score": calib_stats.get("brier_score"),
            "expected_calibration_error": calib_stats.get("ece"),
            "avg_net_return_pct": round(avg_net_return * 100, 3),
            "calibration_status": calib_stats.get("status", "UNKNOWN"),
        },
        "promotion_decision": {
            "status": "APPROVED" if promotion_eligible else "SHADOW_OBSERVATION_CONTINUING",
            "eligible_for_live_promotion": promotion_eligible,
            "minimum_samples_required": 30,
            "current_samples": completed_count,
            "reason": (
                "Candidate satisfies prospective holdout accuracy, calibration, and sample threshold."
                if promotion_eligible
                else f"Not approved: requires 30 completed observations of one frozen model/target, ECE <= 0.05, and target-hit rate >= 0.55; currently {completed_count} validated observations."
            ),
        },
        "calibration_bins": calib_stats.get("bins", []),
    }

    out_dir = config.OUTPUTS_DIR / "prospective"
    out_dir.mkdir(parents=True, exist_ok=True)
    report_json_path = out_dir / "prospective_shadow_report.json"
    with open(report_json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    # Generate Markdown Summary
    report_md_path = out_dir / "prospective_shadow_report.md"
    md_content = f"""# Prospective Shadow Evaluation Report

Generated: {report['generated_at']}
Protocol: {report['evaluation_protocol']}
Status: **{report['promotion_decision']['status']}**

## 1. Sample Size & Observation Coverage
- **Total Predictions Recorded**: {report['sample_statistics']['total_predictions']}
- **Completed Outcomes**: {report['sample_statistics']['completed_observations']}
- **Unresolved / Pending**: {report['sample_statistics']['unresolved_pending']}
- **Coverage Rate**: {report['sample_statistics']['coverage_rate'] * 100:.1f}%

## 2. Prospective Performance Metrics
- **Overall Win Rate**: {report['performance_metrics']['overall_win_rate'] * 100:.1f}%
- **High-Confidence Win Rate (>=70%)**: {report['performance_metrics']['high_confidence_win_rate'] * 100 if report['performance_metrics']['high_confidence_win_rate'] is not None else 0.0:.1f}% ({report['performance_metrics']['high_confidence_samples']} samples)
- **Brier Score**: {report['performance_metrics']['brier_score']}
- **Expected Calibration Error (ECE)**: {report['performance_metrics']['expected_calibration_error'] * 100 if report['performance_metrics']['expected_calibration_error'] is not None else 0.0:.2f}%
- **Average Net Return**: {report['performance_metrics']['avg_net_return_pct']:.2f}%
- **Calibration Status**: {report['performance_metrics']['calibration_status']}

## 3. Model Promotion Gate
- **Eligible for Live Promotion**: {report['promotion_decision']['eligible_for_live_promotion']}
- **Rule**: {report['acceptance_rule']}
- **Assessment**: {report['promotion_decision']['reason']}
"""
    with open(report_md_path, "w", encoding="utf-8") as f:
        f.write(md_content)

    logger.info(f"Generated prospective shadow evaluation report: {report_json_path}")
    return report


if __name__ == "__main__":
    report = run_prospective_shadow_evaluation()
    print(json.dumps(report, indent=2))
