"""
Axion Real-Time Sentiment & Signal Fusion Module.
Provides live multi-source ingestion, FinBERT/VADER scoring,
multi-window aggregation, and technical-sentiment fusion.
"""

from .entity_mapper import EntityMapper, StockEntity
from .collectors import MultiSourceCollector, NewsItem
from .scorers import SentimentScorer, ScoredSentimentItem
from .aggregator import SentimentAggregator, StockSentimentMetrics
from .fusion import SignalFusionEngine, FusedSignalResult

__all__ = [
    "EntityMapper",
    "StockEntity",
    "MultiSourceCollector",
    "NewsItem",
    "SentimentScorer",
    "ScoredSentimentItem",
    "SentimentAggregator",
    "StockSentimentMetrics",
    "SignalFusionEngine",
    "FusedSignalResult",
]
