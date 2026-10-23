"""Pure auditing, outcomes, feature and temporal-partition logic for clean research."""
import numpy as np
import pandas as pd

from src.clean_contract import PRICE_FEATURES, MARKET_FEATURES, assert_no_synthetic, validate_clean_schema

PARTITIONS = ("fit", "early_stop", "calibration", "policy", "evaluation")


def audit_bars(raw, cutoff, *, benchmark=False):
    required = ["Date", "Open", "High", "Low", "Close", "Volume"]
    if not set(required).issubset(raw.columns):
        raise ValueError("Raw OHLCV columns are missing")
    assert_no_synthetic(raw.columns)
    frame = raw[required].copy()
    frame["Date"] = pd.to_datetime(frame["Date"], errors="coerce")
    if frame.Date.isna().any() or frame.Date.duplicated().any():
        raise ValueError("Invalid or duplicated session dates")
    if frame.Date.dt.tz is not None or not frame.Date.eq(frame.Date.dt.normalize()).all():
        raise ValueError("Expected timezone-free daily session dates")
    frame = frame.sort_values("Date").reset_index(drop=True)
    future = frame.Date > pd.Timestamp(cutoff)
    frame = frame.loc[~future].copy()
    for column in required[1:]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    finite = np.isfinite(frame[required[1:]].to_numpy()).all(axis=1)
    bad = ~finite | (frame[["Open", "High", "Low", "Close"]] <= 0).any(axis=1) | (frame.Volume < 0)
    bad |= frame.High < frame[["Open", "Close", "Low"]].max(axis=1)
    bad |= frame.Low > frame[["Open", "Close", "High"]].min(axis=1)
    zero_volume = frame.Volume.eq(0)
    # Quarantine unexplained discontinuities; do not repair corporate actions by guessing.
    jumps = frame.Close.pct_change(fill_method=None).abs() > 0.4
    excluded = bad | jumps | (zero_volume if not benchmark else False)
    report = {"input_rows": len(raw), "beyond_cutoff": int(future.sum()), "invalid_ohlcv": int(bad.sum()),
              "zero_volume": int(zero_volume.sum()), "large_close_jumps": int(jumps.sum()),
              "excluded_dates": frame.loc[excluded, "Date"].dt.strftime("%Y-%m-%d").tolist(),
              "accepted_rows": int((~excluded).sum())}
    if benchmark and excluded.any():
        raise ValueError(f"Benchmark has invalid/discontinuous bars: {report}")
    return frame.loc[~excluded].reset_index(drop=True), report


def daily_outcomes(open_price, high, low, close, contract, *, stress=False):
    """Shared label/execution approximation. Entry/exit slippage applied once per side."""
    multiplier = contract["cost_stress_multiplier"] if stress else 1.0
    slip = contract["slippage_per_side"] * multiplier
    fee = contract["roundtrip_fee"] * multiplier
    entry = np.asarray(open_price, dtype=float) * (1 + slip)
    target = entry * (1 + contract["target_pct"])
    stop = entry * (1 - contract["stop_pct"])
    stopped = np.asarray(low) <= stop
    hit = (np.asarray(high) >= target) & ~stopped
    exit_price = np.where(stopped, stop, np.where(hit, target, np.asarray(close)))
    net = exit_price * (1 - slip) / entry - 1 - fee
    return hit.astype(int), net, np.where(stopped, "stop", np.where(hit, "target", "close"))


def build_clean_frame(stock, benchmark, ticker, contract):
    from src.features import compute_stock_features
    calendar = benchmark.Date.reset_index(drop=True)
    position = pd.Series(np.arange(len(calendar)), index=calendar)
    stock = stock.loc[stock.Date.isin(calendar)].copy().reset_index(drop=True)
    if len(stock) < 60:
        raise ValueError("Fewer than 60 aligned stock sessions")
    frame = compute_stock_features(stock)
    frame["session_number"] = frame.Date.map(position)
    # Every feature in this allowlist uses at most 50 past sessions. Require 51 contiguous
    # observations, including the reference bar, after any quarantined/missing stock bar.
    contiguous = frame.session_number.diff().eq(1).rolling(50, min_periods=50).sum().eq(50)
    market = benchmark[["Date", "Close"]].copy()
    for count in (1, 5, 20):
        market[f"nifty_ret_{count}d"] = market.Close.pct_change(count, fill_method=None)
    market["nifty_trend"] = market.Close / market.Close.rolling(50).mean() - 1
    frame = frame.merge(market[["Date", *MARKET_FEATURES]], on="Date", how="left", validate="one_to_one")
    frame["ticker"] = ticker
    frame["outcome_end"] = frame.Date.shift(-1)
    adjacent_outcome = frame.session_number.shift(-1).eq(frame.session_number + 1)
    for column in ("Open", "High", "Low", "Close"):
        frame[f"next_{column.lower()}"] = frame[column].shift(-1)
    frame["target"], frame["net_return"], frame["exit_reason"] = daily_outcomes(
        *(frame[f"next_{column}"] for column in ("open", "high", "low", "close")), contract)
    _, frame["stress_net_return"], _ = daily_outcomes(
        *(frame[f"next_{column}"] for column in ("open", "high", "low", "close")), contract, stress=True)
    selected = ["Date", "ticker", "outcome_end", "target", "net_return", "stress_net_return", "exit_reason", *PRICE_FEATURES, *MARKET_FEATURES]
    result = frame.loc[contiguous & adjacent_outcome, selected].replace([np.inf, -np.inf], np.nan)
    assert_no_synthetic(result.columns)
    return result.reset_index(drop=True)


def make_fold_manifest(calendar, contract):
    days = pd.DatetimeIndex(sorted(set(pd.to_datetime(calendar))))
    sizes = [contract[f"{name}_sessions"] for name in PARTITIONS[1:]]
    first = contract["min_fit_sessions"] + sum(sizes[:-1])
    folds = []
    for evaluation_start in range(first, len(days) - sizes[-1] + 1, sizes[-1]):
        fit_end = evaluation_start - sum(sizes[:-1])
        edges = [0, fit_end]
        for size in sizes:
            edges.append(edges[-1] + size)
        partitions = {}
        for index, name in enumerate(PARTITIONS):
            start, end = edges[index], edges[index + 1]
            # Outcomes must finish BEFORE the next partition opens; the terminal
            # evaluation session also supplies outcomes, not same-day predictions.
            partitions[name] = {"start": str(days[start].date()), "end": str(days[end - 1].date()),
                                "outcome_before": str(days[end].date()) if end < len(days) else str((days[-1] + pd.Timedelta(days=1)).date())}
        folds.append({"id": f"fold-{len(folds) + 1}", "partitions": partitions})
    if not folds:
        raise ValueError("Not enough verified sessions for the five chronological partitions")
    return folds[-contract["max_folds"]:]


def partition_frame(frame, fold, contract):
    if frame.duplicated(["Date", "ticker"]).any() or frame.outcome_end.isna().any() or (frame.outcome_end <= frame.Date).any():
        raise ValueError("Invalid or duplicate sample/outcome intervals")
    parts, report = {}, {}
    previous = None
    for name in PARTITIONS:
        spec = fold["partitions"][name]
        start, end, before = map(pd.Timestamp, (spec["start"], spec["end"], spec["outcome_before"]))
        if start > end or before <= end or (previous is not None and start <= previous):
            raise ValueError("Overlapping or invalid partition boundaries")
        previous = end
        block = frame.loc[frame.Date.between(start, end)].copy()
        purged = block.outcome_end >= before
        block = block.loc[~purged].sort_values(["Date", "ticker"]).reset_index(drop=True)
        counts = block.target.value_counts()
        if len(block) < contract["min_rows_per_partition"] or set(counts.index) != {0, 1} or counts.min() < contract["min_class_count"]:
            raise ValueError(f"{name}: insufficient rows or class coverage")
        parts[name] = block
        report[name] = {**spec, "rows": len(block), "positives": int(block.target.sum()), "purged": int(purged.sum())}
    for left, right in zip(PARTITIONS, PARTITIONS[1:]):
        if parts[left].outcome_end.max() >= pd.Timestamp(fold["partitions"][right]["start"]):
            raise ValueError("An outcome overlaps a later partition")
    return parts, report


def fit_clean_medians(fit, columns):
    validate_clean_schema(columns)
    medians = fit[list(columns)].replace([np.inf, -np.inf], np.nan).median()
    if medians.isna().any():
        raise ValueError("A training feature has no observations; refusing invented imputation")
    return {column: float(medians[column]) for column in columns}


def clean_matrix(frame, columns, medians):
    validate_clean_schema(columns)
    assert_no_synthetic(frame.columns)
    if set(medians) != set(columns) or not np.isfinite(list(medians.values())).all():
        raise ValueError("Training medians do not match the clean schema")
    matrix = frame[list(columns)].replace([np.inf, -np.inf], np.nan).fillna(medians).astype("float32")
    if not np.isfinite(matrix.to_numpy()).all():
        raise ValueError("Nonfinite clean feature vector")
    return matrix
