"""
Signal Fusion Engine: Technical Analysis + Real-Time Market Sentiment.
Blends technical indicators (RSI, MACD, Moving Averages) with multi-horizon
sentiment metrics using dynamic regime-adaptive weighting.
Generates composite action, confidence percentage, and natural language explanations.
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from .aggregator import StockSentimentMetrics


@dataclass
class TechnicalSignals:
    rsi: Optional[float] = 50.0  # e.g., 28.5 (oversold) to 75.0 (overbought)
    macd_histogram: Optional[float] = 0.0  # > 0 bullish crossover, < 0 bearish
    sma_trend: Optional[str] = "NEUTRAL"  # "BULLISH" (Price > 50 SMA), "BEARISH", "NEUTRAL"
    volatility_atr_pct: Optional[float] = 2.0  # Average True Range %
    normalized_technical_score: Optional[float] = None  # Explicit score in [-1.0, 1.0]

    def get_computed_score(self) -> float:
        """Derive normalized technical score [-1.0, 1.0] if not explicitly provided."""
        if self.normalized_technical_score is not None:
            return max(-1.0, min(1.0, self.normalized_technical_score))

        score = 0.0
        # 1. RSI contribution (mean reversion & momentum boundaries)
        if self.rsi is not None:
            if self.rsi <= 30:  # Oversold -> Bullish bounce potential
                score += 0.40 * (1.0 - (self.rsi / 30.0)) + 0.30
            elif self.rsi >= 70:  # Overbought -> Bearish pullback potential
                score -= 0.40 * ((self.rsi - 70.0) / 30.0) + 0.30
            else:
                # RSI 50 is neutral
                score += 0.30 * ((self.rsi - 50.0) / 20.0)

        # 2. MACD Histogram contribution
        if self.macd_histogram is not None:
            if self.macd_histogram > 0:
                score += min(0.35, self.macd_histogram * 0.15)
            elif self.macd_histogram < 0:
                score -= min(0.35, abs(self.macd_histogram) * 0.15)

        # 3. SMA Trend contribution
        if self.sma_trend == "BULLISH":
            score += 0.25
        elif self.sma_trend == "BEARISH":
            score -= 0.25

        return max(-1.0, min(1.0, score))


@dataclass
class FusedSignalResult:
    ticker: str
    composite_action: str  # "STRONG_BUY", "BUY", "HOLD", "SELL", "STRONG_SELL"
    composite_score: float  # -1.0 to +1.0
    confidence_pct: float  # 0% to 100%
    technical_score: float  # -1.0 to +1.0
    sentiment_score: float  # -1.0 to +1.0
    technical_weight: float  # dynamically adjusted weight
    sentiment_weight: float  # dynamically adjusted weight
    divergence_detected: bool
    explanation: str
    key_drivers: List[str]

    def to_dict(self) -> Dict:
        return {
            "ticker": self.ticker,
            "compositeAction": self.composite_action,
            "compositeScore": round(self.composite_score, 4),
            "confidencePct": round(self.confidence_pct, 1),
            "technicalScore": round(self.technical_score, 4),
            "sentimentScore": round(self.sentiment_score, 4),
            "weights": {
                "technical": round(self.technical_weight, 2),
                "sentiment": round(self.sentiment_weight, 2),
            },
            "divergenceDetected": self.divergence_detected,
            "explanation": self.explanation,
            "keyDrivers": self.key_drivers,
        }


class SignalFusionEngine:
    """
    Adaptive Signal Fusion Engine combining quantitative oscillators with sentiment.
    """

    def __init__(
        self,
        base_technical_weight: float = 0.60,
        base_sentiment_weight: float = 0.40,
        agreement_bonus: float = 0.15,
    ):
        self.base_tech_weight = base_technical_weight
        self.base_sent_weight = base_sentiment_weight
        self.agreement_bonus = agreement_bonus

    def fuse(
        self,
        ticker: str,
        technicals: TechnicalSignals,
        sentiment: StockSentimentMetrics,
    ) -> FusedSignalResult:
        """
        Combine technicals and sentiment metrics into a finalized trading conviction.
        """
        tech_score = technicals.get_computed_score()
        sent_score = sentiment.overall_sentiment_score

        # 1. Dynamic Weight Adjustment (Regime-Adaptive)
        # If there is a massive volume spike or strong catalyst in recent news, sentiment takes precedence
        tech_weight = self.base_tech_weight
        sent_weight = self.base_sent_weight

        if sentiment.is_volume_spike or abs(sentiment.sentiment_momentum) > 0.40:
            # Shift weight toward breaking news catalyst
            sent_weight = min(0.65, self.base_sent_weight + 0.20)
            tech_weight = 1.0 - sent_weight
        elif sentiment.window_24h.item_count == 0:
            # Zero news in last 24h -> technicals dominate
            tech_weight = 0.90
            sent_weight = 0.10

        # 2. Compute Weighted Composite Score
        composite_score = (tech_score * tech_weight) + (sent_score * sent_weight)
        composite_score = max(-1.0, min(1.0, composite_score))

        # 3. Detect Divergence vs Agreement
        # Both positive or both negative = Agreement
        is_agreement = (tech_score > 0.10 and sent_score > 0.10) or (tech_score < -0.10 and sent_score < -0.10)
        # One strongly positive, the other strongly negative = Divergence
        is_divergence = (tech_score > 0.25 and sent_score < -0.25) or (tech_score < -0.25 and sent_score > 0.25)

        # 4. Calculate Confidence Percentage
        base_confidence = 50.0 + (abs(composite_score) * 35.0)
        if is_agreement:
            base_confidence = min(96.0, base_confidence + (self.agreement_bonus * 100.0))
        elif is_divergence:
            # Conflicting signals reduce statistical confidence
            base_confidence = max(30.0, base_confidence - 20.0)

        # 5. Determine Composite Action
        if composite_score >= 0.55:
            action = "STRONG_BUY"
        elif composite_score >= 0.20:
            action = "BUY"
        elif composite_score <= -0.55:
            action = "STRONG_SELL"
        elif composite_score <= -0.20:
            action = "SELL"
        else:
            action = "HOLD"

        # 6. Generate Natural Language Explanation & Drivers
        drivers = []
        explanation_parts = []

        # Technical context
        if technicals.rsi is not None:
            if technicals.rsi <= 32:
                drivers.append(f"RSI oversold at {technicals.rsi:.1f} (bullish mean-reversion setup)")
            elif technicals.rsi >= 68:
                drivers.append(f"RSI overbought at {technicals.rsi:.1f} (distribution exhaustion)")
            else:
                drivers.append(f"RSI neutral at {technicals.rsi:.1f}")

        if technicals.sma_trend != "NEUTRAL":
            drivers.append(f"Price trending {technicals.sma_trend.lower()} relative to moving averages")

        # Sentiment context
        if sentiment.overall_sentiment_label != "NEUTRAL":
            drivers.append(
                f"Market sentiment is {sentiment.overall_sentiment_label.lower()} (score: {sent_score:+.2f})"
            )

        if sentiment.sentiment_momentum > 0.15:
            drivers.append(f"Rapid positive sentiment acceleration (+{sentiment.sentiment_momentum:.2f}/hr)")
        elif sentiment.sentiment_momentum < -0.15:
            drivers.append(f"Sentiment deteriorating sharply ({sentiment.sentiment_momentum:.2f}/hr)")

        if sentiment.is_volume_spike:
            drivers.append(f"News velocity spike detected ({sentiment.volume_surge_ratio:.1f}x baseline rate)")

        # Synthesis sentence
        if is_agreement:
            if composite_score > 0:
                explanation = (
                    f"Strong technical momentum aligns with positive news flow. Both indicators confirm "
                    f"a bullish continuation setup with {base_confidence:.0f}% modeled confidence."
                )
            else:
                explanation = (
                    f"Technical breakdown coincides with negative headline sentiment. Bearish signals "
                    f"are mutually reinforcing with {base_confidence:.0f}% modeled confidence."
                )
        elif is_divergence:
            explanation = (
                f"Signal Divergence Detected: Technical indicators ({tech_score:+.2f}) conflict with recent "
                f"sentiment ({sent_score:+.2f}). Model reduces position confidence to {base_confidence:.0f}%; "
                f"wait for confirmation before entering."
            )
        else:
            explanation = (
                f"Balanced market conditions. Technical oscillator ({tech_score:+.2f}) and baseline news flow "
                f"({sent_score:+.2f}) indicate a neutral consolidation range."
            )

        return FusedSignalResult(
            ticker=ticker,
            composite_action=action,
            composite_score=composite_score,
            confidence_pct=base_confidence,
            technical_score=tech_score,
            sentiment_score=sent_score,
            technical_weight=tech_weight,
            sentiment_weight=sent_weight,
            divergence_detected=is_divergence,
            explanation=explanation,
            key_drivers=drivers,
        )
