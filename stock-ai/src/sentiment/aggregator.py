"""
Rolling Multi-Window Sentiment Aggregator.
Computes multi-horizon sentiment metrics: 15-minute fast, 1-hour medium,
and 24-hour slow windows. Generates sentiment momentum, volume spike signals,
positive/negative ratios, and source dispersion.
"""

import math
import statistics
import time
from dataclasses import dataclass
from typing import Dict, List, Optional

from .scorers import ScoredSentimentItem


@dataclass
class WindowMetrics:
    window_name: str
    duration_minutes: int
    item_count: int
    mean_sentiment: float  # Weighted by credibility and decay
    positive_count: int
    negative_count: int
    neutral_count: int
    pos_neg_ratio: float
    dispersion: float  # Standard deviation of sentiment across stories


@dataclass
class StockSentimentMetrics:
    ticker: str
    as_of_timestamp: float
    window_15m: WindowMetrics
    window_1h: WindowMetrics
    window_24h: WindowMetrics
    sentiment_momentum: float  # (mean_15m - mean_1h) or velocity of sentiment shift
    volume_surge_ratio: float  # Fast window volume vs expected baseline rate
    is_volume_spike: bool
    overall_sentiment_score: float  # Combined normalized score [-1.0, +1.0]
    overall_sentiment_label: str  # "BULLISH", "BEARISH", "NEUTRAL"
    recent_catalysts: List[Dict]

    def to_dict(self) -> Dict:
        return {
            "ticker": self.ticker,
            "asOfTimestamp": self.as_of_timestamp,
            "overallScore": round(self.overall_sentiment_score, 4),
            "overallLabel": self.overall_sentiment_label,
            "sentimentMomentum": round(self.sentiment_momentum, 4),
            "volumeSurgeRatio": round(self.volume_surge_ratio, 2),
            "isVolumeSpike": self.is_volume_spike,
            "windows": {
                "15m": {
                    "count": self.window_15m.item_count,
                    "meanSentiment": round(self.window_15m.mean_sentiment, 4),
                    "posCount": self.window_15m.positive_count,
                    "negCount": self.window_15m.negative_count,
                    "posNegRatio": round(self.window_15m.pos_neg_ratio, 2),
                    "dispersion": round(self.window_15m.dispersion, 3),
                },
                "1h": {
                    "count": self.window_1h.item_count,
                    "meanSentiment": round(self.window_1h.mean_sentiment, 4),
                    "posCount": self.window_1h.positive_count,
                    "negCount": self.window_1h.negative_count,
                    "posNegRatio": round(self.window_1h.pos_neg_ratio, 2),
                    "dispersion": round(self.window_1h.dispersion, 3),
                },
                "24h": {
                    "count": self.window_24h.item_count,
                    "meanSentiment": round(self.window_24h.mean_sentiment, 4),
                    "posCount": self.window_24h.positive_count,
                    "negCount": self.window_24h.negative_count,
                    "posNegRatio": round(self.window_24h.pos_neg_ratio, 2),
                    "dispersion": round(self.window_24h.dispersion, 3),
                },
            },
            "recentCatalysts": self.recent_catalysts[:5],
        }


class SentimentAggregator:
    """
    Computes rolling window metrics and anomaly indicators for stock sentiment.
    """

    def __init__(self, volume_surge_threshold: float = 2.0):
        self.volume_surge_threshold = volume_surge_threshold

    def _compute_window(
        self, items: List[ScoredSentimentItem], name: str, duration_min: int
    ) -> WindowMetrics:
        if not items:
            return WindowMetrics(
                window_name=name,
                duration_minutes=duration_min,
                item_count=0,
                mean_sentiment=0.0,
                positive_count=0,
                negative_count=0,
                neutral_count=0,
                pos_neg_ratio=1.0,
                dispersion=0.0,
            )

        pos_count = sum(1 for i in items if i.sentiment_label == "positive")
        neg_count = sum(1 for i in items if i.sentiment_label == "negative")
        neu_count = sum(1 for i in items if i.sentiment_label == "neutral")

        # Ratio of positive to negative stories
        ratio = float(pos_count) / float(max(1, neg_count))

        # Credibility-weighted mean
        weights = [i.credibility_weight * i.time_decay_weight for i in items]
        total_weight = sum(weights)
        if total_weight > 0:
            weighted_scores = [item.raw_score * w for item, w in zip(items, weights)]
            mean_score = sum(weighted_scores) / total_weight
        else:
            mean_score = 0.0

        # Dispersion (standard deviation of raw sentiment)
        if len(items) > 1:
            raw_scores = [i.raw_score for i in items]
            dispersion = statistics.stdev(raw_scores)
        else:
            dispersion = 0.0

        return WindowMetrics(
            window_name=name,
            duration_minutes=duration_min,
            item_count=len(items),
            mean_sentiment=mean_score,
            positive_count=pos_count,
            negative_count=neg_count,
            neutral_count=neu_count,
            pos_neg_ratio=ratio,
            dispersion=dispersion,
        )

    def aggregate(
        self,
        ticker: str,
        scored_items: List[ScoredSentimentItem],
        current_time: Optional[float] = None,
    ) -> StockSentimentMetrics:
        """
        Aggregate a ticker's scored news into multi-horizon rolling windows.
        """
        now = current_time or time.time()
        # Filter items by ticker
        ticker_items = [i for i in scored_items if i.ticker == ticker]

        # Slice items into windows: 15m (900s), 1h (3600s), 24h (86400s)
        items_15m = [i for i in ticker_items if (now - i.published_timestamp) <= 900]
        items_1h = [i for i in ticker_items if (now - i.published_timestamp) <= 3600]
        items_24h = [i for i in ticker_items if (now - i.published_timestamp) <= 86400]

        w15 = self._compute_window(items_15m, "15m", 15)
        w1h = self._compute_window(items_1h, "1h", 60)
        w24h = self._compute_window(items_24h, "24h", 1440)

        # Sentiment momentum: if fast window is moving higher than 1-hour window
        if w1h.item_count > 0 and w15.item_count > 0:
            momentum = w15.mean_sentiment - w1h.mean_sentiment
        elif w24h.item_count > 0 and w1h.item_count > 0:
            momentum = w1h.mean_sentiment - w24h.mean_sentiment
        else:
            momentum = 0.0

        # News volume surge: compare recent 1-hour rate against daily average hourly rate
        hourly_expected = max(0.5, w24h.item_count / 24.0)
        volume_surge_ratio = float(w1h.item_count) / hourly_expected
        is_spike = volume_surge_ratio >= self.volume_surge_threshold and w1h.item_count >= 3

        # Overall composite sentiment: 40% 1h, 30% 15m, 30% 24h (or fallback to available)
        weights_sum = 0.0
        weighted_val = 0.0

        if w15.item_count > 0:
            weighted_val += 0.35 * w15.mean_sentiment
            weights_sum += 0.35
        if w1h.item_count > 0:
            weighted_val += 0.40 * w1h.mean_sentiment
            weights_sum += 0.40
        if w24h.item_count > 0:
            weighted_val += 0.25 * w24h.mean_sentiment
            weights_sum += 0.25

        if weights_sum > 0:
            overall_score = weighted_val / weights_sum
        elif ticker_items:
            # Fallback to mean of all items
            overall_score = sum(i.adjusted_score for i in ticker_items) / len(ticker_items)
        else:
            overall_score = 0.0

        # Determine qualitative label
        if overall_score >= 0.20:
            label = "BULLISH"
        elif overall_score <= -0.20:
            label = "BEARISH"
        else:
            label = "NEUTRAL"

        # Format top catalysts sorted by absolute impact
        catalysts = [
            {
                "title": item.title,
                "score": round(item.raw_score, 3),
                "adjustedScore": round(item.adjusted_score, 3),
                "source": item.source_name,
                "publishedAt": item.published_at,
                "engine": item.scoring_engine,
            }
            for item in sorted(ticker_items, key=lambda x: abs(x.adjusted_score), reverse=True)
        ]

        return StockSentimentMetrics(
            ticker=ticker,
            as_of_timestamp=now,
            window_15m=w15,
            window_1h=w1h,
            window_24h=w24h,
            sentiment_momentum=momentum,
            volume_surge_ratio=volume_surge_ratio,
            is_volume_spike=is_spike,
            overall_sentiment_score=overall_score,
            overall_sentiment_label=label,
            recent_catalysts=catalysts,
        )
