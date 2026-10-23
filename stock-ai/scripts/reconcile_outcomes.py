"""
CLI Reconciliation Script for Axion Prediction Ledger.
Walks unresolved prospective predictions for a given trading session,
fetches price data, resolves trade execution states, and writes immutable outcome records.
"""

import argparse
import sys
from pathlib import Path
from datetime import datetime, timezone
import pandas as pd
import yfinance as yf

# Add project root to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))
from src import ledger


def fetch_session_bar(ticker: str, session_date: str):
    start = pd.Timestamp(session_date)
    end = start + pd.Timedelta(days=4)
    frame = yf.download(
        ticker,
        start=start.strftime('%Y-%m-%d'),
        end=end.strftime('%Y-%m-%d'),
        auto_adjust=False,
        progress=False,
        threads=False,
    )
    if frame is None or frame.empty:
        return None
    if isinstance(frame.columns, pd.MultiIndex):
        frame.columns = frame.columns.get_level_values(0)
    frame = frame.copy()
    frame.index = pd.to_datetime(frame.index).tz_localize(None)
    rows = frame[frame.index.strftime('%Y-%m-%d') == session_date]
    if rows.empty:
        return None
    row = rows.iloc[0]
    values = {name: float(row[name]) for name in ('Open', 'High', 'Low', 'Close')}
    if not all(pd.notna(value) and value > 0 for value in values.values()):
        return None
    return values


def resolve_daily_outcome(prediction, bar):
    entry = bar['Open']
    target = entry * (1.0 + float(prediction.get('target_pct', 0.02)))
    stop = entry * (1.0 - float(prediction.get('stop_pct', 0.02)))
    stop_hit = bar['Low'] <= stop
    target_hit = bar['High'] >= target
    if stop_hit:
        return 'STOP_HIT', stop
    if target_hit:
        return 'TARGET_HIT', target
    return 'TIME_EXIT', bar['Close']

def run_reconciliation(session_date: str):
    session_close = datetime.fromisoformat(session_date + 'T15:30:00+05:30')
    if datetime.now(timezone.utc) < session_close:
        raise ValueError('Cannot reconcile an unfinished trading session')
    print("=" * 65)
    print(f"RUNNING OUTCOME RECONCILIATION FOR SESSION: {session_date}")
    print("=" * 65)

    all_preds = ledger.load_all_predictions()
    existing_outcomes = {o["prediction_id"]: o for o in ledger.load_all_outcomes()}

    target_preds = [
        p for p in all_preds
        if p.get("intended_session") == session_date and p["prediction_id"] not in existing_outcomes
        and ledger.prospective_prediction_error(p) is None
    ]

    print(f"Found {len(target_preds)} pending predictions for session {session_date}.")
    if not target_preds:
        print("All predictions for this session are already reconciled or none were recorded.")
        summary = ledger.get_ledger_performance_summary()
        print("\nLedger Summary:", summary)
        return

    # Reconcile only from observed daily OHLC; unavailable data remains pending.
    reconciled_count = 0
    for p in target_preds:
        bar = fetch_session_bar(p['ticker'], session_date)
        if bar is None:
            print(f"No verified OHLC for {p['ticker']} on {session_date}; leaving pending.")
            continue
        outcome_status, exit_price = resolve_daily_outcome(p, bar)
        ledger.record_outcome(
            prediction_id=p["prediction_id"],
            ticker=p["ticker"],
            intended_session=session_date,
            outcome_status=outcome_status,
            entry_occurred=True,
            fill_price=bar['Open'],
            exit_price=exit_price,
            price_source='yahoo_finance_daily_ohlc',
            observed_bar=bar,
            notes="Resolved from observed Yahoo Finance daily OHLC; stop-first when target and stop conflict."
        )
        reconciled_count += 1

    print(f"Reconciled {reconciled_count} predictions successfully.")
    summary = ledger.get_ledger_performance_summary()
    print("\nUpdated Ledger Summary:")
    print(f"  Total Recorded:   {summary['total_recorded']}")
    print(f"  Total Reconciled: {summary['total_reconciled']}")
    print(f"  Target Hits:      {summary['target_hits']}")
    print(f"  Stop Hits:        {summary['stop_hits']}")
    print(f"  Win Rate:         {summary.get('win_rate', 0) * 100:.1f}%")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Reconcile daily prospective outcomes.")
    parser.add_argument("--date", default=datetime.now(timezone.utc).strftime("%Y-%m-%d"), help="Session date YYYY-MM-DD")
    args = parser.parse_args()
    run_reconciliation(args.date)
