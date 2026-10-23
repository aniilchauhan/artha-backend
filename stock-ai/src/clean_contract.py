"""Versioned, explicit input contract for clean research candidates."""

FEATURE_VERSION = "clean-price-market-v1"
PRICE_FEATURES = (
    "ret_1d", "ret_5d", "ret_20d", "close_to_sma20", "close_to_sma50",
    "rsi_14", "atr_pct", "daily_hl_pct", "vol_20d", "bb_position",
    "bb_width", "vol_to_sma5", "vol_to_sma20", "vol_trend_5_20",
    "candle_body_pct", "close_location", "gap_pct", "dist_from_20d_high",
)
MARKET_FEATURES = ("nifty_ret_1d", "nifty_ret_5d", "nifty_ret_20d", "nifty_trend")
FORBIDDEN_PREFIXES = ("sentiment", "fii", "dii", "inst_", "institutional", "buzz")


def assert_no_synthetic(columns):
    forbidden = [str(name) for name in columns if str(name).lower().startswith(FORBIDDEN_PREFIXES)]
    if forbidden:
        raise ValueError(f"Synthetic/unverified feature columns are forbidden in clean mode: {sorted(forbidden)}")


def validate_clean_schema(columns):
    assert_no_synthetic(columns)
    if not columns or len(columns) != len(set(columns)):
        raise ValueError("Clean feature schema must be nonempty and unique")
    unknown = set(columns) - set(PRICE_FEATURES + MARKET_FEATURES)
    if unknown:
        raise ValueError(f"Features outside the clean allowlist: {sorted(unknown)}")
