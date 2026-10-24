"""
Financial Sentiment Scoring Engine.
Features FinBERT (ProsusAI/finbert) as the primary finance transformer,
with automatic fallback to VADER & Financial NLP Lexicons.
Computes label, raw score [-1, +1], confidence, credibility weighting,
and exponential time decay.
"""

import math
import logging
import re
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from .collectors import NewsItem

logger = logging.getLogger(__name__)

# Built-in High-Impact Financial Lexicon for Indian & Global Markets
# (Fast, zero-dependency, and calibrated for financial jargon)
FINANCIAL_BULLISH_LEXICON: Dict[str, float] = {
    "record high": 1.0,
    "all-time high": 1.0,
    "multifold": 0.85,
    "profit jumps": 0.85,
    "profit surges": 0.90,
    "revenue up": 0.75,
    "beat estimates": 0.80,
    "beats estimates": 0.80,
    "guidance raised": 0.85,
    "upgrade": 0.70,
    "upgraded": 0.75,
    "buyback": 0.80,
    "order win": 0.75,
    "dividend payout": 0.65,
    "strong demand": 0.70,
    "outperform": 0.75,
    "rally": 0.65,
    "surges": 0.70,
    "soars": 0.75,
    "turnaround": 0.80,
    "secures contract": 0.75,
    "fda approval": 0.90,
    "expansion": 0.60,
    "acquisition": 0.55,
}

FINANCIAL_BEARISH_LEXICON: Dict[str, float] = {
    "record low": -1.0,
    "profit plunges": -0.90,
    "profit drops": -0.75,
    "misses estimates": -0.80,
    "guidance slashed": -0.90,
    "downgrade": -0.75,
    "downgraded": -0.80,
    "fraud": -1.0,
    "investigation": -0.85,
    "sebi penalty": -0.95,
    "default": -1.0,
    "debt crisis": -0.90,
    "slumps": -0.75,
    "tumbles": -0.75,
    "crash": -0.90,
    "plummets": -0.85,
    "layoffs": -0.65,
    "regulatory probe": -0.85,
    "resignation": -0.60,
    "margin squeeze": -0.70,
    "warning": -0.65,
    "underperform": -0.75,
    "selloff": -0.70,
}


@dataclass
class ScoredSentimentItem:
    item_id: str
    ticker: str
    title: str
    summary: str
    source_name: str
    source_type: str
    published_at: str
    published_timestamp: float
    url: str
    sentiment_label: str  # "positive", "neutral", "negative"
    raw_score: float  # Range: -1.0 to +1.0
    confidence: float  # Range: 0.0 to 1.0
    credibility_weight: float
    time_decay_weight: float
    adjusted_score: float  # raw_score * credibility_weight * time_decay_weight
    scoring_engine: str  # "FinBERT", "VADER", "Lexicon"

    def to_dict(self) -> Dict:
        return {
            "itemId": self.item_id,
            "ticker": self.ticker,
            "title": self.title,
            "summary": self.summary,
            "sourceName": self.source_name,
            "sourceType": self.source_type,
            "publishedAt": self.published_at,
            "publishedTimestamp": self.published_timestamp,
            "url": self.url,
            "sentimentLabel": self.sentiment_label,
            "rawScore": round(self.raw_score, 4),
            "confidence": round(self.confidence, 4),
            "credibilityWeight": round(self.credibility_weight, 3),
            "timeDecayWeight": round(self.time_decay_weight, 3),
            "adjustedScore": round(self.adjusted_score, 4),
            "scoringEngine": self.scoring_engine,
        }


class SentimentScorer:
    """
    Multi-tier financial sentiment scorer.
    Attempts FinBERT via transformers pipeline, then VADER,
    then fallback calibrated financial lexicon.
    """

    def __init__(
        self,
        use_finbert: bool = True,
        device: str = "cpu",
        half_life_hours: float = 8.0,
    ):
        self.use_finbert = use_finbert
        self.device = device
        self.half_life_hours = max(0.5, half_life_hours)
        self.lambda_decay = math.log(2.0) / (self.half_life_hours * 3600.0)

        self._finbert_pipeline = None
        self._vader_analyzer = None

        self._init_models()

    def _init_models(self) -> None:
        """Dynamically load FinBERT and VADER if available in environment."""
        if self.use_finbert:
            try:
                from transformers import pipeline, AutoTokenizer, AutoModelForSequenceClassification

                logger.info("Initializing FinBERT pipeline (ProsusAI/finbert)...")
                model_name = "ProsusAI/finbert"
                # device: -1 for CPU, 0+ for GPU
                dev_idx = 0 if self.device.startswith("cuda") else -1
                self._finbert_pipeline = pipeline(
                    "text-classification",
                    model=model_name,
                    tokenizer=model_name,
                    device=dev_idx,
                    top_k=None,  # Return probabilities for all 3 classes
                )
                logger.info("FinBERT pipeline loaded successfully.")
            except Exception as e:
                logger.info(f"FinBERT optional load deferred: {e}. Falling back to VADER/Lexicon.")
                self._finbert_pipeline = None

        try:
            from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
            self._vader_analyzer = SentimentIntensityAnalyzer()
        except ImportError:
            try:
                import nltk
                from nltk.sentiment.vader import SentimentIntensityAnalyzer
                nltk.download("vader_lexicon", quiet=True)
                self._vader_analyzer = SentimentIntensityAnalyzer()
            except Exception:
                self._vader_analyzer = None

    def clean_text(self, text: str) -> str:
        """Sanitize text: remove URLs, handle emojis, remove ticker prefixes."""
        if not text:
            return ""
        # Strip URL hyperlinks
        text = re.sub(r"http\S+|www\.\S+", "", text)
        # Remove repeated punctuations
        text = re.sub(r"([!?.]){2,}", r"\1", text)
        # Normalize whitespace
        text = re.sub(r"\s+", " ", text).strip()
        return text

    def compute_time_decay(self, published_timestamp: float, current_time: Optional[float] = None) -> float:
        """
        Compute exponential recency weight:
        weight = exp(-lambda * delta_t_seconds)
        """
        now = current_time or time.time()
        age_seconds = max(0.0, now - published_timestamp)
        decay = math.exp(-self.lambda_decay * age_seconds)
        # Floor decay at 0.05 so past news never completely zeroes out if relevant
        return max(0.05, min(1.0, decay))

    def _score_with_finbert(self, text: str) -> Optional[Tuple[str, float, float]]:
        """Score text using FinBERT. Returns (label, score, confidence) or None."""
        if not self._finbert_pipeline:
            return None

        try:
            # FinBERT labels: positive, negative, neutral
            truncated = text[:512]
            results = self._finbert_pipeline(truncated)
            # results format: [[{'label': 'positive', 'score': 0.85}, {'label': 'neutral', ...}, ...]]
            if isinstance(results, list) and len(results) > 0 and isinstance(results[0], list):
                scores = {item["label"].lower(): item["score"] for item in results[0]}
                pos = scores.get("positive", 0.0)
                neg = scores.get("negative", 0.0)
                neu = scores.get("neutral", 0.0)

                # Composite score from -1.0 to +1.0
                composite = pos - neg
                if pos > neg and pos > neu:
                    label = "positive"
                    confidence = pos
                elif neg > pos and neg > neu:
                    label = "negative"
                    confidence = neg
                else:
                    label = "neutral"
                    confidence = neu

                return label, composite, confidence
        except Exception as e:
            logger.debug(f"FinBERT inference exception: {e}")
        return None

    def _score_with_vader(self, text: str) -> Optional[Tuple[str, float, float]]:
        """Score text using VADER analyzer."""
        if not self._vader_analyzer:
            return None

        try:
            scores = self._vader_analyzer.polarity_scores(text)
            compound = scores.get("compound", 0.0)
            pos = scores.get("pos", 0.0)
            neg = scores.get("neg", 0.0)
            neu = scores.get("neu", 0.0)

            if compound >= 0.05:
                label = "positive"
            elif compound <= -0.05:
                label = "negative"
            else:
                label = "neutral"

            confidence = max(pos, neg, neu)
            return label, compound, confidence
        except Exception as e:
            logger.debug(f"VADER inference exception: {e}")
        return None

    def _score_with_lexicon(self, text: str) -> Tuple[str, float, float]:
        """Calibrated fallback Financial Lexicon scoring engine."""
        lowered = text.lower()
        score = 0.0
        matches = 0

        for phrase, weight in FINANCIAL_BULLISH_LEXICON.items():
            if phrase in lowered:
                score += weight
                matches += 1

        for phrase, weight in FINANCIAL_BEARISH_LEXICON.items():
            if phrase in lowered:
                score += weight  # weight is already negative
                matches += 1

        if matches == 0:
            return "neutral", 0.0, 0.50

        # Bound score between -1.0 and +1.0
        normalized = max(-1.0, min(1.0, score / max(1.0, math.sqrt(matches))))
        confidence = min(0.95, 0.50 + 0.15 * matches)

        if normalized > 0.10:
            label = "positive"
        elif normalized < -0.10:
            label = "negative"
        else:
            label = "neutral"

        return label, normalized, confidence

    def score_item(self, item: NewsItem, current_time: Optional[float] = None) -> ScoredSentimentItem:
        """
        Analyze a NewsItem through the tiered pipeline,
        apply source credibility, and calculate time decay.
        """
        now = current_time or time.time()
        combined_text = self.clean_text(f"{item.title}. {item.summary}")

        engine = "Lexicon"
        result = None

        # Tier 1: FinBERT
        if self._finbert_pipeline:
            result = self._score_with_finbert(combined_text)
            if result:
                engine = "FinBERT"

        # Tier 2: VADER
        if result is None and self._vader_analyzer:
            result = self._score_with_vader(combined_text)
            if result:
                engine = "VADER"

        # Tier 3: Financial NLP Lexicon
        if result is None:
            result = self._score_with_lexicon(combined_text)
            engine = "Lexicon"

        label, raw_score, confidence = result
        time_decay = self.compute_time_decay(item.published_timestamp, now)
        adjusted_score = raw_score * item.credibility_weight * time_decay

        return ScoredSentimentItem(
            item_id=item.item_id,
            ticker=item.ticker,
            title=item.title,
            summary=item.summary,
            source_name=item.source_name,
            source_type=item.source_type,
            published_at=item.published_at,
            published_timestamp=item.published_timestamp,
            url=item.url,
            sentiment_label=label,
            raw_score=raw_score,
            confidence=confidence,
            credibility_weight=item.credibility_weight,
            time_decay_weight=time_decay,
            adjusted_score=adjusted_score,
            scoring_engine=engine,
        )

    def score_batch(self, items: List[NewsItem]) -> List[ScoredSentimentItem]:
        """Process and score a list of NewsItem objects."""
        now = time.time()
        return [self.score_item(item, now) for item in items]
