"""
Axion Immutable Prediction and Outcome Ledger Service.
Provides append-only prospective tracking of opportunities before outcomes occur,
and attaches reconciled trade executions post-session without mutating original prediction records.
"""

from datetime import datetime, timezone, timedelta
import hashlib
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional
import uuid

# Add project root to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
LEDGER_DIR = BASE_DIR / "outputs" / "ledger"
PREDICTIONS_DIR = LEDGER_DIR / "predictions"
OUTCOMES_DIR = LEDGER_DIR / "outcomes"

PREDICTIONS_DIR.mkdir(parents=True, exist_ok=True)
OUTCOMES_DIR.mkdir(parents=True, exist_ok=True)

logger = logging.getLogger(__name__)


def prospective_prediction_error(record):
    """A forward observation must be frozen before the NSE 09:15 IST open."""
    try:
        session = datetime.strptime(record['intended_session'], '%Y-%m-%d')
        market_open = session.replace(hour=9, minute=15, tzinfo=timezone(timedelta(hours=5, minutes=30)))
        recorded = datetime.fromisoformat(record['recorded_at'].replace('Z', '+00:00'))
        cutoff = datetime.fromisoformat(record['input_cutoff'].replace('Z', '+00:00'))
        if recorded.tzinfo is None or cutoff.tzinfo is None:
            return 'Missing timezone'
        if recorded >= market_open or cutoff >= market_open or cutoff > recorded:
            return 'Prediction or input cutoff was not frozen before market open'
        return None
    except (KeyError, TypeError, ValueError):
        return 'Invalid prospective timestamps'


def validated_observations():
    predictions = load_all_predictions()
    valid = [p for p in predictions if prospective_prediction_error(p) is None]
    by_id = {p['prediction_id']: p for p in valid}
    outcomes = []
    for outcome in load_all_outcomes():
        pred = by_id.get(outcome.get('prediction_id'))
        if (pred and outcome.get('ticker') == pred.get('ticker')
                and outcome.get('intended_session') == pred.get('intended_session')
                and outcome.get('price_source') == 'yahoo_finance_daily_ohlc'
                and outcome.get('observed_bar')):
            outcomes.append(outcome)
    return valid, outcomes, len(predictions) - len(valid)


def _get_monthly_file(directory: Path, prefix: str, dt_str: Optional[str] = None) -> Path:
    """Generates monthly partitioned ledger file path."""
    if dt_str:
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    else:
        dt = datetime.now(timezone.utc)
    month_str = dt.strftime("%Y-%m")
    return directory / f"{prefix}_{month_str}.jsonl"


def record_prediction(
    ticker: str,
    horizon: str,
    intended_session: str,
    reference_price: float,
    score: float,
    calibrated_prob: Optional[float] = None,
    entry_condition: str = "market_open",
    target_pct: float = 0.02,
    stop_pct: float = 0.02,
    target_version: str = "TARGET_EXEC_OPEN_2PCT",
    model_version: str = "2.0-executable",
    input_cutoff: Optional[str] = None,
    positive_drivers: Optional[List[Dict[str, Any]]] = None,
    negative_drags: Optional[List[Dict[str, Any]]] = None,
    custom_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Appends a new prediction record immutably to the ledger before market open.
    """
    now_utc = datetime.now(timezone.utc).isoformat()
    prediction_id = custom_id or f"pred_{uuid.uuid4().hex[:12]}"

    target_price = round(reference_price * (1.0 + target_pct), 2)
    stop_price = round(reference_price * (1.0 - stop_pct), 2)

    record = {
        "prediction_id": prediction_id,
        "recorded_at": now_utc,
        "ticker": ticker.upper(),
        "horizon": horizon,
        "intended_session": intended_session,
        "model_version": model_version,
        "target_version": target_version,
        "input_cutoff": input_cutoff or now_utc,
        "reference_price": float(reference_price),
        "entry_condition": entry_condition,
        "target_pct": float(target_pct),
        "stop_pct": float(stop_pct),
        "target_price": target_price,
        "stop_price": stop_price,
        "deadline": "15:25 IST",
        "raw_score": float(score),
        "calibrated_prob": float(calibrated_prob) if calibrated_prob is not None else float(score),
        "positive_drivers": positive_drivers or [],
        "negative_drags": negative_drags or [],
        "status": "PENDING_EXECUTION",
    }

    error = prospective_prediction_error(record)
    if error:
        raise ValueError(error)

    # Generate record hash for integrity
    record_bytes = json.dumps(record, sort_keys=True).encode("utf-8")
    record["record_hash"] = hashlib.sha256(record_bytes).hexdigest()[:16]

    file_path = _get_monthly_file(PREDICTIONS_DIR, "predictions", now_utc)
    with open(file_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")

    logger.info(f"[Ledger] Recorded prospective prediction {prediction_id} for {ticker} ({intended_session})")
    return record


def record_outcome(
    prediction_id: str,
    ticker: str,
    intended_session: str,
    outcome_status: str,
    entry_occurred: bool,
    fill_price: Optional[float] = None,
    exit_price: Optional[float] = None,
    entry_time: Optional[str] = None,
    exit_time: Optional[str] = None,
    friction_pct: float = 0.0015,
    notes: Optional[str] = None,
    price_source: Optional[str] = None,
    observed_bar: Optional[Dict[str, float]] = None,
) -> Dict[str, Any]:
    """
    Appends an outcome record resolving a prior prediction without mutating the original prediction.
    """
    now_utc = datetime.now(timezone.utc).isoformat()
    outcome_id = f"out_{uuid.uuid4().hex[:12]}"

    gross_return = None
    net_return = None

    if entry_occurred and fill_price and exit_price and fill_price > 0:
        gross_return = round((exit_price - fill_price) / fill_price, 6)
        net_return = round(gross_return - friction_pct, 6)

    outcome_record = {
        "outcome_id": outcome_id,
        "prediction_id": prediction_id,
        "reconciled_at": now_utc,
        "ticker": ticker.upper(),
        "intended_session": intended_session,
        "outcome_status": outcome_status,  # TARGET_HIT, STOP_HIT, TIME_EXIT, AMBIGUOUS, NOT_TRIGGERED, DATA_MISSING
        "entry_occurred": entry_occurred,
        "fill_price": float(fill_price) if fill_price is not None else None,
        "exit_price": float(exit_price) if exit_price is not None else None,
        "entry_time": entry_time,
        "exit_time": exit_time,
        "gross_return": gross_return,
        "friction_pct": friction_pct,
        "net_return": net_return,
        "notes": notes or "",
        "price_source": price_source,
        "observed_bar": observed_bar,
    }

    record_bytes = json.dumps(outcome_record, sort_keys=True).encode("utf-8")
    outcome_record["record_hash"] = hashlib.sha256(record_bytes).hexdigest()[:16]

    file_path = _get_monthly_file(OUTCOMES_DIR, "outcomes", now_utc)
    with open(file_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(outcome_record) + "\n")

    logger.info(f"[Ledger] Reconciled outcome for {prediction_id} -> {outcome_status} (Net: {net_return})")
    return outcome_record


def load_all_predictions(limit: Optional[int] = None) -> List[Dict[str, Any]]:
    """Loads all recorded predictions chronologically across monthly partitions."""
    predictions = []
    files = sorted(PREDICTIONS_DIR.glob("predictions_*.jsonl"), reverse=True)
    for f in files:
        with open(f, "r", encoding="utf-8") as fp:
            for line in fp:
                line = line.strip()
                if line:
                    try:
                        predictions.append(json.loads(line))
                    except Exception:
                        pass
        if limit and len(predictions) >= limit:
            break
    return predictions[:limit] if limit else predictions


def load_all_outcomes(limit: Optional[int] = None) -> List[Dict[str, Any]]:
    """Loads all reconciled outcomes chronologically across monthly partitions."""
    outcomes = []
    files = sorted(OUTCOMES_DIR.glob("outcomes_*.jsonl"), reverse=True)
    for f in files:
        with open(f, "r", encoding="utf-8") as fp:
            for line in fp:
                line = line.strip()
                if line:
                    try:
                        outcomes.append(json.loads(line))
                    except Exception:
                        pass
        if limit and len(outcomes) >= limit:
            break
    return outcomes[:limit] if limit else outcomes


def get_ledger_performance_summary() -> Dict[str, Any]:
    """
    Computes audited prospective performance metrics from reconciled ledger outcomes.
    """
    predictions, outcomes, excluded = validated_observations()
    if not outcomes:
        return {
            "total_predictions": len(predictions),
            "excluded_predictions": excluded,
            "reconciled_count": 0,
            "win_rate": None,
            "target_hits": 0,
            "stop_hits": 0,
            "time_exits": 0,
            "avg_net_return": None,
            "message": "No outcomes reconciled yet. Prospective ledger active.",
        }

    valid_trades = [o for o in outcomes if o.get("entry_occurred") and o.get("net_return") is not None]
    target_hits = sum(1 for o in outcomes if o.get("outcome_status") == "TARGET_HIT")
    stop_hits = sum(1 for o in outcomes if o.get("outcome_status") == "STOP_HIT")
    time_exits = sum(1 for o in outcomes if o.get("outcome_status") == "TIME_EXIT")
    not_triggered = sum(1 for o in outcomes if o.get("outcome_status") == "NOT_TRIGGERED")

    total_executed = len(valid_trades)
    win_rate = round(target_hits / total_executed, 4) if total_executed > 0 else 0.0
    avg_net = round(sum(o["net_return"] for o in valid_trades) / total_executed, 6) if total_executed > 0 else 0.0

    return {
        "total_recorded": len(predictions),
        "excluded_predictions": excluded,
        "total_reconciled": len(outcomes),
        "total_executed": total_executed,
        "not_triggered": not_triggered,
        "target_hits": target_hits,
        "stop_hits": stop_hits,
        "time_exits": time_exits,
        "win_rate": win_rate,
        "avg_net_return_pct": round(avg_net * 100, 3),
        "status": "AUDITED_PROSPECTIVE",
    }
