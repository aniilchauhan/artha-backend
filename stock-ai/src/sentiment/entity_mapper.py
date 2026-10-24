"""
Stock Entity Recognition & Ticker Mapping Module.
Maps raw headline text, articles, or social posts to precise stock ticker symbols
using boundary-aware regex patterns, alias maps, and corporate executive entities.
"""

import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Set, Tuple


@dataclass
class StockEntity:
    ticker: str
    company_name: str
    exchange: str
    sector: str
    aliases: List[str]


# Default comprehensive map for Indian NSE/BSE & major market symbols
DEFAULT_ENTITIES: Dict[str, Dict] = {
    "RELIANCE.NS": {
        "name": "Reliance Industries",
        "exchange": "NSE",
        "sector": "Energy / Retail / Telecom",
        "aliases": ["Reliance", "RIL", "Jio", "Mukesh Ambani", "Reliance Retail", "Reliance Ind"],
    },
    "TCS.NS": {
        "name": "Tata Consultancy Services",
        "exchange": "NSE",
        "sector": "IT Services",
        "aliases": ["TCS", "Tata Consultancy", "Tata Sons", "K Krithivasan"],
    },
    "INFY.NS": {
        "name": "Infosys",
        "exchange": "NSE",
        "sector": "IT Services",
        "aliases": ["Infosys", "Infy", "Salil Parekh", "Narayana Murthy"],
    },
    "HDFCBANK.NS": {
        "name": "HDFC Bank",
        "exchange": "NSE",
        "sector": "Banking",
        "aliases": ["HDFC Bank", "HDFCBK", "Sashidhar Jagdishan"],
    },
    "ICICIBANK.NS": {
        "name": "ICICI Bank",
        "exchange": "NSE",
        "sector": "Banking",
        "aliases": ["ICICI Bank", "ICICI", "Sandeep Bakhshi"],
    },
    "SBIN.NS": {
        "name": "State Bank of India",
        "exchange": "NSE",
        "sector": "PSU Banking",
        "aliases": ["State Bank of India", "SBI", "State Bank", "Dinesh Khara", "CS Setty"],
    },
    "BHARTIARTL.NS": {
        "name": "Bharti Airtel",
        "exchange": "NSE",
        "sector": "Telecom",
        "aliases": ["Bharti Airtel", "Airtel", "Sunil Mittal", "Gopal Vittal"],
    },
    "TATAMOTORS.NS": {
        "name": "Tata Motors",
        "exchange": "NSE",
        "sector": "Automotive",
        "aliases": ["Tata Motors", "TaMo", "JLR", "Jaguar Land Rover"],
    },
    "LT.NS": {
        "name": "Larsen & Toubro",
        "exchange": "NSE",
        "sector": "Infrastructure / Capital Goods",
        "aliases": ["Larsen & Toubro", "L&T", "Larsen and Toubro", "AM Naik", "SN Subrahmanyan"],
    },
    "MARUTI.NS": {
        "name": "Maruti Suzuki",
        "exchange": "NSE",
        "sector": "Automotive",
        "aliases": ["Maruti Suzuki", "Maruti", "Suzuki Motor"],
    },
    "ITC.NS": {
        "name": "ITC Limited",
        "exchange": "NSE",
        "sector": "FMCG / Hotels",
        "aliases": ["ITC Limited", "ITC share", "ITC Ltd", "Sanjiv Puri"],
    },
    "KOTAKBANK.NS": {
        "name": "Kotak Mahindra Bank",
        "exchange": "NSE",
        "sector": "Banking",
        "aliases": ["Kotak Mahindra", "Kotak Bank", "Uday Kotak"],
    },
    "AXISBANK.NS": {
        "name": "Axis Bank",
        "exchange": "NSE",
        "sector": "Banking",
        "aliases": ["Axis Bank", "Axis", "Amitabh Chaudhry"],
    },
    "BAJFINANCE.NS": {
        "name": "Bajaj Finance",
        "exchange": "NSE",
        "sector": "NBFC",
        "aliases": ["Bajaj Finance", "Bajaj Finserv", "Sanjiv Bajaj"],
    },
    "WIPRO.NS": {
        "name": "Wipro",
        "exchange": "NSE",
        "sector": "IT Services",
        "aliases": ["Wipro", "Azim Premji", "Rishad Premji", "Srini Pallia"],
    },
    "HINDUNILVR.NS": {
        "name": "Hindustan Unilever",
        "exchange": "NSE",
        "sector": "FMCG",
        "aliases": ["Hindustan Unilever", "HUL", "Unilever India", "Rohit Jawa"],
    },
    "SUNPHARMA.NS": {
        "name": "Sun Pharmaceutical",
        "exchange": "NSE",
        "sector": "Pharma",
        "aliases": ["Sun Pharma", "Sun Pharmaceutical", "Dilip Shanghvi"],
    },
    "TATASTEEL.NS": {
        "name": "Tata Steel",
        "exchange": "NSE",
        "sector": "Metals",
        "aliases": ["Tata Steel", "TV Narendran"],
    },
}


class EntityMapper:
    """
    High-performance entity extraction engine with word-boundary checks
    and disambiguation to avoid common false positives.
    """

    def __init__(self, entities: Optional[Dict[str, Dict]] = None):
        self.entities: Dict[str, StockEntity] = {}
        # Precompiled regex patterns mapping compiled_regex -> ticker
        self._compiled_patterns: List[Tuple[re.Pattern, str]] = []
        # Ambiguity blocklist (common short English words that collide with tickers)
        self.ambiguous_terms = {"IT", "ON", "AT", "AI", "BE", "AS", "SO", "GO", "DO", "IN"}

        source_dict = entities if entities is not None else DEFAULT_ENTITIES
        self._initialize_entities(source_dict)

    def _initialize_entities(self, entity_dict: Dict[str, Dict]) -> None:
        for ticker, meta in entity_dict.items():
            stock = StockEntity(
                ticker=ticker,
                company_name=meta.get("name", ticker),
                exchange=meta.get("exchange", "NSE"),
                sector=meta.get("sector", "General"),
                aliases=meta.get("aliases", []),
            )
            self.entities[ticker] = stock

            # Collect terms: base symbol (e.g. RELIANCE from RELIANCE.NS), full name, and all aliases
            raw_sym = ticker.split(".")[0].upper()
            terms_to_match = set(stock.aliases)
            terms_to_match.add(stock.company_name)
            if len(raw_sym) >= 3 and raw_sym not in self.ambiguous_terms:
                terms_to_match.add(raw_sym)
                terms_to_match.add(ticker)

            for term in terms_to_match:
                term_clean = term.strip()
                if not term_clean or len(term_clean) < 2:
                    continue
                # Boundary matching to avoid substring collision (e.g. "going" matching "GO")
                pattern_str = r"(?i)\b" + re.escape(term_clean) + r"\b"
                try:
                    compiled = re.compile(pattern_str)
                    self._compiled_patterns.append((compiled, ticker))
                except re.error:
                    continue

    def match_tickers(self, text: str) -> List[str]:
        """
        Extract all matching stock tickers from a piece of text.
        Returns unique list of tickers sorted by match frequency.
        """
        if not text:
            return []

        counts: Dict[str, int] = {}
        for pattern, ticker in self._compiled_patterns:
            matches = pattern.findall(text)
            if matches:
                counts[ticker] = counts.get(ticker, 0) + len(matches)

        # Sort tickers by occurrence frequency descending
        sorted_tickers = sorted(counts.keys(), key=lambda t: counts[t], reverse=True)
        return sorted_tickers

    def match_primary_ticker(self, text: str, fallback_ticker: Optional[str] = None) -> Optional[str]:
        """
        Extract the most prominent stock ticker mentioned in the text.
        """
        matches = self.match_tickers(text)
        if matches:
            return matches[0]
        return fallback_ticker

    def get_entity_metadata(self, ticker: str) -> Optional[StockEntity]:
        """Retrieve stored metadata for a given ticker."""
        return self.entities.get(ticker)
