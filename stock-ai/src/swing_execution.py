"""Single source of truth for daily swing entry and exit decisions."""
from typing import Any, Dict, Optional

FRICTION = 0.0015
ENTRY_SLIPPAGE = 0.0005


def resolve_entry(bar: Dict[str, Any], trigger: float, max_gap: float = 0.03) -> Dict[str, Any]:
    opening = float(bar["Open"])
    if opening > trigger * (1 + max_gap):
        return {"status": "skipped_gap_too_large"}
    if opening > trigger:
        return {"status": "active", "entry_price": opening * (1 + ENTRY_SLIPPAGE), "entry_mode": "gap"}
    if float(bar["High"]) >= trigger:
        return {"status": "active", "entry_price": trigger * (1 + ENTRY_SLIPPAGE), "entry_mode": "intraday"}
    return {"status": "watching"}


def resolve_exit(
    bar: Dict[str, Any],
    entry_price: float,
    target_price: float,
    stop_price: float,
    *,
    entry_bar: bool = False,
    trailing_stop: Optional[float] = None,
) -> Optional[Dict[str, Any]]:
    """Resolve one bar in priority order; later highs never rewrite an opening fill."""
    stop = trailing_stop if trailing_stop is not None else stop_price
    opening = float(bar["Open"])
    if not entry_bar and opening <= stop:
        return {"status": "stopped", "exit_price": opening, "reason": "gap_stop"}
    if not entry_bar and opening >= target_price:
        return {"status": "target_hit", "exit_price": opening, "reason": "gap_target"}
    if float(bar["Low"]) <= stop:
        return {"status": "stopped", "exit_price": stop, "reason": "intraday_stop"}
    if float(bar["High"]) >= target_price:
        return {"status": "target_hit", "exit_price": target_price, "reason": "intraday_target"}
    return None


def net_return(exit_price: float, entry_price: float) -> float:
    return round((float(exit_price) / float(entry_price) - 1) - FRICTION, 6)

def stop_for_next_bar(stop: float, entry: float, completed_high: float) -> float:
    """A completed bar can tighten only the following bar's stop."""
    return max(stop, entry * (1 + FRICTION)) if completed_high >= entry * 1.06 else stop
