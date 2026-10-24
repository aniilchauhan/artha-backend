"""
Unified Sentiment & Fusion Pipeline Service.
Coordinates Collectors -> Scorers -> Aggregator -> Fusion Engine
with high-speed in-memory caching and background refresh.
"""

import logging
import time
from typing import Dict, List, Optional

from .aggregator import SentimentAggregator, StockSentimentMetrics
from .collectors import MultiSourceCollector, NewsItem
from .entity_mapper import EntityMapper
from .fusion import FusedSignalResult, SignalFusionEngine, TechnicalSignals
from .scorers import ScoredSentimentItem, SentimentScorer

logger = logging.getLogger(__name__)


class SentimentPipelineService:
    """
    Singleton service managing the lifecycle of the sentiment
    and technical fusion subsystem.
    """

    _instance = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super(SentimentPipelineService, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        logger.info("Initializing SentimentPipelineService...")
        self.entity_mapper = EntityMapper()
        self.collector = MultiSourceCollector(entity_mapper=self.entity_mapper)
        self.scorer = SentimentScorer(use_finbert=True, device="cpu", half_life_hours=8.0)
        self.aggregator = SentimentAggregator(volume_surge_threshold=2.0)
        self.fusion_engine = SignalFusionEngine(
            base_technical_weight=0.60,
            base_sentiment_weight=0.40,
            agreement_bonus=0.15,
        )

        # Cache: ticker -> {"metrics": StockSentimentMetrics, "items": List[ScoredSentimentItem], "updated_at": float}
        self._cache: Dict[str, Dict] = {}
        self.cache_ttl_seconds = 180  # 3 minute cache
        self._initialized = True
        logger.info("SentimentPipelineService initialized successfully.")

    def get_or_fetch_sentiment(self, ticker: str, force_refresh: bool = False) -> Dict:
        """
        Fetch news, compute multi-tier sentiment, and return aggregated metrics.
        Utilizes caching to prevent rate-limit exhaustion.
        """
        now = time.time()
        cached = self._cache.get(ticker)
        if not force_refresh and cached and (now - cached["updated_at"]) < self.cache_ttl_seconds:
            return {
                "ticker": ticker,
                "cached": True,
                "metrics": cached["metrics"].to_dict(),
                "recentStories": [i.to_dict() for i in cached["items"][:10]],
            }

        # 1. Collect
        raw_items = self.collector.collect_all_for_ticker(ticker)

        # 2. Score
        scored_items = self.scorer.score_batch(raw_items)

        # 3. Aggregate
        metrics = self.aggregator.aggregate(ticker, scored_items, current_time=now)

        # 4. Cache
        self._cache[ticker] = {
            "metrics": metrics,
            "items": scored_items,
            "updated_at": now,
        }

        return {
            "ticker": ticker,
            "cached": False,
            "metrics": metrics.to_dict(),
            "recentStories": [i.to_dict() for i in scored_items[:10]],
        }

    def fuse_signals(
        self,
        ticker: str,
        technical_input: Optional[Dict] = None,
        force_refresh: bool = False,
    ) -> Dict:
        """
        Combine technical indicator payload with live sentiment data.
        """
        sentiment_resp = self.get_or_fetch_sentiment(ticker, force_refresh=force_refresh)
        cached_entry = self._cache.get(ticker)
        metrics = cached_entry["metrics"] if cached_entry else None

        if not metrics:
            metrics = self.aggregator.aggregate(ticker, [], time.time())

        # Construct technical signals
        tech_dict = technical_input or {}
        tech_signals = TechnicalSignals(
            rsi=tech_dict.get("rsi", 50.0),
            macd_histogram=tech_dict.get("macdHistogram", 0.0),
            sma_trend=tech_dict.get("smaTrend", "NEUTRAL"),
            normalized_technical_score=tech_dict.get("normalizedScore"),
        )

        fused = self.fusion_engine.fuse(ticker, tech_signals, metrics)

        return {
            "ticker": ticker,
            "fusion": fused.to_dict(),
            "sentiment": sentiment_resp["metrics"],
            "disclaimer": "Informational quantitative scenario modeling only. Not SEBI registered investment advice.",
        }


# Global singleton instance
pipeline_service = SentimentPipelineService()
