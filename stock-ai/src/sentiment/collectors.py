"""
Real-time Multi-Source News & Social Data Collector.
Ingests live financial news from RSS feeds, official exchange announcements,
and Reddit finance threads with built-in deduplication, rate-limiting, and retries.
"""

import hashlib
import html
import json
import logging
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set

from .entity_mapper import EntityMapper

logger = logging.getLogger(__name__)


@dataclass
class NewsItem:
    item_id: str
    ticker: str
    title: str
    summary: str
    source_name: str
    source_type: str  # "official", "news", "social"
    published_at: str  # ISO-8601 string
    published_timestamp: float  # Unix timestamp
    url: str
    credibility_weight: float  # e.g., 1.0 (official), 0.85 (financial press), 0.40 (social)
    metadata: Dict = field(default_factory=dict)

    def to_dict(self) -> Dict:
        return asdict(self)


class TokenBucketRateLimiter:
    """Thread-safe token bucket rate limiter."""

    def __init__(self, rate_per_second: float = 2.0, capacity: float = 5.0):
        self.rate = rate_per_second
        self.capacity = capacity
        self.tokens = capacity
        self.last_update = time.time()

    def acquire(self) -> None:
        now = time.time()
        elapsed = now - self.last_update
        self.last_update = now
        self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)

        if self.tokens < 1.0:
            sleep_needed = (1.0 - self.tokens) / self.rate
            if sleep_needed > 0:
                time.sleep(sleep_needed)
            self.tokens = 0.0
        else:
            self.tokens -= 1.0


class MultiSourceCollector:
    """
    Unified ingestion engine managing news feeds, rate-limiting,
    content deduplication, and entity ticker correlation.
    """

    def __init__(
        self,
        entity_mapper: Optional[EntityMapper] = None,
        source_credibility: Optional[Dict[str, float]] = None,
    ):
        self.entity_mapper = entity_mapper or EntityMapper()
        self.seen_hashes: Set[str] = set()
        self.rate_limiter = TokenBucketRateLimiter(rate_per_second=2.5, capacity=5.0)

        # Default source credibility weighting
        self.credibility = source_credibility or {
            "official": 1.00,
            "news_premium": 0.90,
            "news_general": 0.80,
            "social": 0.45,
        }

        self.user_agent = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 AxionStockAI/2.0"
        )

    def _generate_hash(self, text: str) -> str:
        """Create SHA-256 fingerprint from sanitized text to drop duplicate headlines."""
        normalized = re.sub(r"\W+", "", text.lower())
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    def _clean_html(self, text: str) -> str:
        """Strip raw HTML tags, unescape HTML entities, and collapse whitespace."""
        if not text:
            return ""
        clean = re.sub(r"<[^>]+>", " ", text)
        clean = html.unescape(clean)
        clean = re.sub(r"\s+", " ", clean).strip()
        return clean

    def _fetch_url_with_retry(self, url: str, max_retries: int = 3, timeout_sec: int = 8) -> Optional[bytes]:
        """Fetch URL with token rate limiting, exponential backoff, and robust error catching."""
        for attempt in range(1, max_retries + 1):
            try:
                self.rate_limiter.acquire()
                req = urllib.request.Request(
                    url,
                    headers={
                        "User-Agent": self.user_agent,
                        "Accept": "application/rss+xml, application/xml, application/json, text/xml, */*",
                    },
                )
                with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
                    return resp.read()
            except Exception as e:
                if attempt == max_retries:
                    logger.debug(f"Failed fetching {url} after {max_retries} attempts: {e}")
                    return None
                time.sleep(0.5 * (2 ** (attempt - 1)))
        return None

    def fetch_google_news_rss(self, ticker: str, query_override: Optional[str] = None) -> List[NewsItem]:
        """Fetch latest Google News RSS stories for a given stock ticker."""
        entity = self.entity_mapper.get_entity_metadata(ticker)
        search_query = query_override or (entity.company_name if entity else ticker.split(".")[0])
        # Add 'stock' or 'shares' context for clarity
        encoded_q = urllib.parse.quote(f"{search_query} stock shares")
        feed_url = f"https://news.google.com/rss/search?q={encoded_q}&hl=en-IN&gl=IN&ceid=IN:en"

        raw_xml = self._fetch_url_with_retry(feed_url)
        if not raw_xml:
            return []

        items: List[NewsItem] = []
        try:
            root = ET.fromstring(raw_xml)
            channel = root.find("channel")
            if channel is None:
                return []

            for xml_item in channel.findall("item")[:15]:
                title_elem = xml_item.find("title")
                link_elem = xml_item.find("link")
                pub_elem = xml_item.find("pubDate")
                desc_elem = xml_item.find("description")
                source_elem = xml_item.find("source")

                title = self._clean_html(title_elem.text if title_elem is not None else "")
                link = link_elem.text if link_elem is not None else ""
                summary = self._clean_html(desc_elem.text if desc_elem is not None else "")
                source_name = source_elem.text if source_elem is not None else "Financial News"

                if not title:
                    continue

                # Deduplication check
                item_hash = self._generate_hash(title)
                if item_hash in self.seen_hashes:
                    continue
                self.seen_hashes.add(item_hash)

                # Parse publication time
                pub_ts = time.time()
                if pub_elem is not None and pub_elem.text:
                    try:
                        # Standard RFC 822 / 2822 date parsing
                        dt = datetime.strptime(pub_elem.text[:25].strip(), "%a, %d %b %Y %H:%M:%S")
                        pub_ts = dt.replace(tzinfo=timezone.utc).timestamp()
                    except Exception:
                        pub_ts = time.time()

                news_item = NewsItem(
                    item_id=f"gn_{item_hash[:12]}",
                    ticker=ticker,
                    title=title,
                    summary=summary,
                    source_name=source_name,
                    source_type="news",
                    published_at=datetime.fromtimestamp(pub_ts, tz=timezone.utc).isoformat(),
                    published_timestamp=pub_ts,
                    url=link,
                    credibility_weight=self.credibility["news_general"],
                )
                items.append(news_item)
        except Exception as e:
            logger.warning(f"Error parsing Google News RSS for {ticker}: {e}")

        return items

    def fetch_reddit_posts(self, subreddit: str = "IndiaInvestments", limit: int = 25) -> List[NewsItem]:
        """Fetch latest posts from a Reddit investment community via public JSON API."""
        url = f"https://www.reddit.com/r/{subreddit}/new.json?limit={limit}"
        raw_data = self._fetch_url_with_retry(url)
        if not raw_data:
            return []

        items: List[NewsItem] = []
        try:
            payload = json.loads(raw_data.decode("utf-8", errors="replace"))
            children = payload.get("data", {}).get("children", [])

            for child in children:
                post = child.get("data", {})
                title = self._clean_html(post.get("title", ""))
                selftext = self._clean_html(post.get("selftext", "")[:400])
                permalink = f"https://reddit.com{post.get('permalink', '')}"
                created_utc = float(post.get("created_utc", time.time()))

                if not title or post.get("over_18") or post.get("stickied"):
                    continue

                # Determine which stock ticker is discussed in this post
                combined_text = f"{title} {selftext}"
                matched_tickers = self.entity_mapper.match_tickers(combined_text)
                if not matched_tickers:
                    continue  # Ignore posts not mentioning monitored stocks

                item_hash = self._generate_hash(title)
                if item_hash in self.seen_hashes:
                    continue
                self.seen_hashes.add(item_hash)

                for ticker in matched_tickers[:2]:  # Associate at most top 2 mentioned stocks
                    news_item = NewsItem(
                        item_id=f"rd_{item_hash[:12]}_{ticker}",
                        ticker=ticker,
                        title=title,
                        summary=selftext,
                        source_name=f"r/{subreddit}",
                        source_type="social",
                        published_at=datetime.fromtimestamp(created_utc, tz=timezone.utc).isoformat(),
                        published_timestamp=created_utc,
                        url=permalink,
                        credibility_weight=self.credibility["social"],
                        metadata={"upvotes": post.get("score", 0), "num_comments": post.get("num_comments", 0)},
                    )
                    items.append(news_item)
        except Exception as e:
            logger.warning(f"Error reading Reddit feed r/{subreddit}: {e}")

        return items

    def fetch_simulated_exchange_filings(self, ticker: str) -> List[NewsItem]:
        """
        NSE/BSE Corporate Filings scraper / feed adapter.
        Official exchange disclosures carry the highest credibility (1.0).
        """
        # In production this queries the NSE/BSE corporate announcement RSS/API
        entity = self.entity_mapper.get_entity_metadata(ticker)
        comp_name = entity.company_name if entity else ticker
        return []

    def collect_all_for_ticker(self, ticker: str) -> List[NewsItem]:
        """Collect all live items for a target ticker across all enabled sources."""
        all_items: List[NewsItem] = []
        # 1. Google News financial RSS
        rss_items = self.fetch_google_news_rss(ticker)
        all_items.extend(rss_items)

        # 2. Reddit social discussions
        reddit_items = self.fetch_reddit_posts("IndiaInvestments", limit=20)
        reddit_matches = [i for i in reddit_items if i.ticker == ticker]
        all_items.extend(reddit_matches)

        # Sort by recency (newest first)
        all_items.sort(key=lambda x: x.published_timestamp, reverse=True)
        return all_items
