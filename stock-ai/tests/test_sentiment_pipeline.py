"""
Automated Unit and Integration Tests for Sentiment & Technical Fusion Pipeline.
"""

import sys
import time
from pathlib import Path

# Support Windows console encoding
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Add stock-ai to path
STOCK_AI_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(STOCK_AI_DIR))

from src.sentiment.entity_mapper import EntityMapper
from src.sentiment.collectors import NewsItem
from src.sentiment.scorers import SentimentScorer
from src.sentiment.aggregator import SentimentAggregator
from src.sentiment.fusion import SignalFusionEngine, TechnicalSignals


def test_entity_mapper():
    print("--> Testing Entity Mapper...")
    mapper = EntityMapper()

    text_1 = "Reliance Industries reports 15% jump in quarterly net profit, Jio subscribers cross 450M."
    tickers_1 = mapper.match_tickers(text_1)
    assert "RELIANCE.NS" in tickers_1, f"Expected RELIANCE.NS, got {tickers_1}"

    text_2 = "TCS secures major 5-year cloud migration deal with European bank."
    tickers_2 = mapper.match_tickers(text_2)
    assert "TCS.NS" in tickers_2, f"Expected TCS.NS, got {tickers_2}"

    text_3 = "Infosys and HDFC Bank lead benchmark rally today."
    tickers_3 = mapper.match_tickers(text_3)
    assert "INFY.NS" in tickers_3 and "HDFCBANK.NS" in tickers_3
    print("✓ Entity Mapper tests passed!")


def test_sentiment_scorer_and_decay():
    print("--> Testing Sentiment Scorer & Time Decay...")
    scorer = SentimentScorer(use_finbert=False, half_life_hours=6.0)

    now = time.time()
    bullish_item = NewsItem(
        item_id="test_1",
        ticker="RELIANCE.NS",
        title="Reliance Industries reports record high profit jumps multifold",
        summary="Company announces huge dividend payout and expansion plans.",
        source_name="Economic Times",
        source_type="news",
        published_at="2026-10-24T10:00:00Z",
        published_timestamp=now - 1800,  # 30 minutes ago
        url="https://example.com/test",
        credibility_weight=0.85,
    )

    scored = scorer.score_item(bullish_item, current_time=now)
    assert scored.raw_score > 0, f"Expected positive score, got {scored.raw_score}"
    assert scored.sentiment_label == "positive"
    assert scored.time_decay_weight > 0.90  # 30 mins old with 6h half life should be > 0.90
    assert scored.adjusted_score > 0
    print(f"✓ Scored Bullish Item: raw={scored.raw_score:.2f}, adj={scored.adjusted_score:.2f}")

    bearish_item = NewsItem(
        item_id="test_2",
        ticker="TCS.NS",
        title="TCS profit drops and misses estimates amid severe debt crisis",
        summary="Management issues margin squeeze warning for upcoming quarter.",
        source_name="Moneycontrol",
        source_type="news",
        published_at="2026-10-24T08:00:00Z",
        published_timestamp=now - 7200,  # 2 hours ago
        url="https://example.com/test2",
        credibility_weight=0.85,
    )
    scored_bear = scorer.score_item(bearish_item, current_time=now)
    assert scored_bear.raw_score < 0, f"Expected negative score, got {scored_bear.raw_score}"
    assert scored_bear.sentiment_label == "negative"
    print(f"✓ Scored Bearish Item: raw={scored_bear.raw_score:.2f}, adj={scored_bear.adjusted_score:.2f}")


def test_aggregator_and_fusion():
    print("--> Testing Aggregator and Signal Fusion...")
    now = time.time()
    scorer = SentimentScorer(use_finbert=False)
    aggregator = SentimentAggregator(volume_surge_threshold=2.0)
    fusion_engine = SignalFusionEngine()

    # Create 3 bullish news items
    news = [
        NewsItem(
            item_id=f"n_{i}",
            ticker="RELIANCE.NS",
            title=f"Reliance surges on record high profit beat #{i}",
            summary="Strong order win and dividend payout.",
            source_name="Reuters",
            source_type="news",
            published_at="2026-10-24T12:00:00Z",
            published_timestamp=now - (i * 300),  # In last 15 minutes
            url=f"https://example.com/{i}",
            credibility_weight=0.90,
        )
        for i in range(4)
    ]

    scored = scorer.score_batch(news)
    metrics = aggregator.aggregate("RELIANCE.NS", scored, current_time=now)

    assert metrics.overall_sentiment_score > 0.20
    assert metrics.overall_sentiment_label == "BULLISH"
    assert metrics.window_15m.item_count == 4
    print(f"✓ Aggregated Metrics: Overall={metrics.overall_sentiment_score:.2f}, Label={metrics.overall_sentiment_label}")

    # Case 1: Oversold RSI (30) + Bullish Sentiment -> Expect STRONG_BUY
    tech_oversold = TechnicalSignals(rsi=25.0, macd_histogram=0.5, sma_trend="BULLISH")
    fused_buy = fusion_engine.fuse("RELIANCE.NS", tech_oversold, metrics)

    assert fused_buy.composite_action in ["BUY", "STRONG_BUY"], f"Got {fused_buy.composite_action}"
    assert fused_buy.confidence_pct >= 75.0
    print(f"✓ Fused Signal (Agreement): Action={fused_buy.composite_action}, Confidence={fused_buy.confidence_pct:.1f}%")
    print(f"  Explanation: {fused_buy.explanation}")

    # Case 2: Divergence - Overbought RSI (78) + Bearish Technicals vs Bullish Sentiment
    tech_overbought = TechnicalSignals(rsi=78.0, macd_histogram=-0.8, sma_trend="BEARISH")
    fused_divergent = fusion_engine.fuse("RELIANCE.NS", tech_overbought, metrics)
    print(f"✓ Fused Signal (Divergence): Action={fused_divergent.composite_action}, Divergence={fused_divergent.divergence_detected}")
    print(f"  Explanation: {fused_divergent.explanation}")


if __name__ == "__main__":
    test_entity_mapper()
    test_sentiment_scorer_and_decay()
    test_aggregator_and_fusion()
    print("\nALL SENTIMENT & FUSION TESTS PASSED CLEANLY! ★★★★★")
