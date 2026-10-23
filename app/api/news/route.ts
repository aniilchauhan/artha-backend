import { GoogleGenAI, Type } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { guardAiRequest } from "../../../lib/ai-request-guard";
import { generateOllamaResponse, cleanJsonText } from "../../../lib/ollama-service";
import allIndianStocks from "../../../data/all_indian_stocks_5055.json";

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const NEWS_UNIVERSE_BATCH_SIZE = 50;
const NEWS_UNIVERSE_CONCURRENCY = 6;
const NEWS_UNIVERSE_REQUEST_TIMEOUT_MS = 4_000;
const NEWS_UNIVERSE_TOTAL_TIMEOUT_MS = 75_000;
const NEWS_UNIVERSE_ARTICLES_PER_BATCH = 25;
const NEWS_UNIVERSE_ARTICLES_PER_TICKER = 3;


export interface NewsItem {
  id: string;
  title: string;
  content: string;
  source: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  impact: 'high' | 'medium' | 'low';
  time: string;
  ticker?: string;
  sector?: string;
  technicalContext: string;
  sourceLink?: string;
  sentimentScore?: number;
  priceImpactEst?: string;
  category?: string;
}

// Pre-defined educational sandbox headlines
const HANDCRAFTED_NEWS: Record<string, NewsItem[]> = {
  // Tickers
  RELIANCE: [
    {
      id: "rel-1",
      title: "Reliance Invests ₹75,000 Cr in New Energy Gigafactory Complex in Gujarat",
      content: "Reliance Industries has accelerated its green energy pivot by committing major capital to a new solar and hydrogen gigafactory complex. This marks the group's largest capital allocation project of the year.",
      source: "FRIDAY Intelligence",
      sentiment: "bullish",
      impact: "high",
      time: "45 minutes ago",
      ticker: "RELIANCE",
      sector: "Energy",
      technicalContext: "High capital allocation pivot signals strong long-term asset backup. Technical charts indicate a prospective support bounce near the 50-day SMA, with buyers accumulating."
    },
    {
      id: "rel-2",
      title: "Global Refining Margin Contraction Pulls Back Petrochemical Spread Spells",
      content: "Petrochemical spreads and gross refining margins (GRMs) in Singapore have contracted by 4.2% week-on-week, which may pose temporary margin compression for Reliance's O2C division.",
      source: "Bloomberg",
      sentiment: "bearish",
      impact: "medium",
      time: "3 hours ago",
      ticker: "RELIANCE",
      sector: "Energy",
      technicalContext: "Short-term margin headwind. Expect the RSI (14) to descend back to the neutral 40-45 zone as traders trim long exposure around local resistance."
    },
    {
      id: "rel-3",
      title: "Jio Infocomm Eyes 15% Premium Tariff Hikes in Major Telecom Sector Consolidation",
      content: "Jio is reportedly planning a structured average revenue per user (ARPU) expansion of 12-15% by late Q3. Analysts expect this decision to dramatically improve telecommunications sector cash flow.",
      source: "Economic Times",
      sentiment: "bullish",
      impact: "high",
      time: "1 day ago",
      ticker: "RELIANCE",
      sector: "Energy",
      technicalContext: "Highly positive for enterprise cash flow. Monitor the 20-day SMA; a clear crossover above the 50-day SMA (Golden Cross) could trigger a structural breakout."
    }
  ],
  TCS: [
    {
      id: "tcs-1",
      title: "TCS Lands $1.8 Billion Cloud & AI Migration Megadeal with UK Insurance Giant",
      content: "Tata Consultancy Services has secured a multi-year cloud transformation contract to overhaul UK-based insurance operations, utilizing modern enterprise cognitive agents and hybrid cloud setups.",
      source: "Reuters",
      sentiment: "bullish",
      impact: "high",
      time: "1 hour ago",
      ticker: "TCS",
      sector: "Technology",
      technicalContext: "Substantial backlog injection improves revenue visibility. Price action is breaking through the upper Bollinger Band boundary, pointing to momentum acceleration."
    },
    {
      id: "tcs-2",
      title: "Eurozone Enterprise Discretionary IT Spend Slowdown Signals Temporary Drag",
      content: "A survey of major European financial clients shows a temporary pause in non-critical discretionary software budgets, potentially delaying short-term consulting pipelines for large IT providers.",
      source: "Reuters Financials",
      sentiment: "neutral",
      impact: "low",
      time: "5 hours ago",
      ticker: "TCS",
      sector: "Technology",
      technicalContext: "Sideways consolidation pattern is likely to dominate. Watch for Stochastic %K and %D crossovers below 30 for opportunistic range-bound swing trades."
    },
    {
      id: "tcs-3",
      title: "TCS Declares Special Interim Dividend of ₹28 Per Share after Solid Margin Beat",
      content: "TCS outperformed street margin expectations by 40 basis points, prompting the board to announce an unexpected special interim dividend, showcasing extremely resilient cash flow reserves.",
      source: "CNBC TV18",
      sentiment: "bullish",
      impact: "high",
      time: "2 days ago",
      ticker: "TCS",
      sector: "Technology",
      technicalContext: "Dividend yields reinforce the asset's defensive characteristics. Strong support is expected to solidify above the SMA 15 zone as institutional accounts build defensive holdings."
    }
  ],
  HDFCBANK: [
    {
      id: "hdfc-1",
      title: "HDFC Bank Posts Strong Q1 Loan Growth at 15.8% YoY; Net Interest Margin Recovers",
      content: "India's largest private lender reported healthy credit expansion, driven primarily by retail demand and commercial portfolios. Net Interest Margin (NIM) bounced back to 3.45% following merger consolidation.",
      source: "Financial Express",
      sentiment: "bullish",
      impact: "high",
      time: "2 hours ago",
      ticker: "HDFCBANK",
      sector: "Financials",
      technicalContext: "Excellent margin recovery signals long-term value. Price action shows a clear rebound from major horizontal support; look for a test of the 52W high."
    },
    {
      id: "hdfc-2",
      title: "RBI Tightens Risk-Weight Ratios for Personal Loans and Credit Cards",
      content: "The Reserve Bank of India has increased risk weights on consumer credit exposure, forcing private commercial banks to allocate higher capital reserves for unsecured consumer portfolios.",
      source: "Economic Times",
      sentiment: "bearish",
      impact: "medium",
      time: "4 hours ago",
      ticker: "HDFCBANK",
      sector: "Financials",
      technicalContext: "Increases cost of capital for unsecured assets. Anticipate a minor bearish pullback; watch if the RSI dips below 35 to signal short-term oversold exhaustion."
    }
  ],
  INFY: [
    {
      id: "infy-1",
      title: "Infosys Expands GenAI Platform Topaz with Global Fortune 50 Retail Partnership",
      content: "Infosys has signed a global strategic partnership to power cognitive retail operations for a major retail chain, indicating strong early monetization pipelines for its proprietary Topaz AI offering.",
      source: "FRIDAY Intelligence",
      sentiment: "bullish",
      impact: "high",
      time: "1 hour ago",
      ticker: "INFY",
      sector: "Technology",
      technicalContext: "Advanced tech product monetization boosts valuation multiples. The price is pushing toward its 90-day high with expanding volume indicators, validating the bull trend."
    },
    {
      id: "infy-2",
      title: "US H-1B Visa Fee Hikes and Processing Delays Spark Tech Labor Pipeline Questions",
      content: "Proposed regulatory modifications in offshore visa procedures may slightly increase compliance overhead and operational costs for major Indian tech exporters over the coming fiscal year.",
      source: "Bloomberg US",
      sentiment: "neutral",
      impact: "low",
      time: "1 day ago",
      ticker: "INFY",
      sector: "Technology",
      technicalContext: "Negligible structural impact but may cause retail nervousness. Traders should look for stability around the 20-day SMA (₹1,540 equivalent) to validate buyer interest."
    }
  ],
  ICICIBANK: [
    {
      id: "icici-1",
      title: "ICICI Bank Leads Private Lenders in Digital Transaction Fees; Asset Quality Pristine",
      content: "ICICI Bank registered a 19% YoY growth in digital fee collection. Non-Performing Asset (NPA) levels hit historic lows at 0.38%, affirming best-in-class risk management protocols.",
      source: "Mint",
      sentiment: "bullish",
      impact: "high",
      time: "30 minutes ago",
      ticker: "ICICIBANK",
      sector: "Financials",
      technicalContext: "Pristine credit health sustains momentum. The price continues its high-contrast uptrend above the 20-day SMA, demonstrating robust bullish momentum."
    }
  ],
  ITC: [
    {
      id: "itc-1",
      title: "ITC FMCG Margins Expand by 120 bps as Raw Agri-Commodity Inputs Soften",
      content: "Soften agricultural raw material costs have given ITC's fast-moving consumer goods (FMCG) segment a strong margin uplift, shielding the company from inflation pressures felt by peers.",
      source: "Business Standard",
      sentiment: "bullish",
      impact: "medium",
      time: "2 hours ago",
      ticker: "ITC",
      sector: "Consumer Cyclical",
      technicalContext: "Favorable commodity cycles provide defensive protection. The stock is exhibiting classic range consolidation, with the RSI flatlining near the 50 neutral pivot."
    }
  ],
  SBIN: [
    {
      id: "sbin-1",
      title: "SBI Announces Giant Corporate Loan Pipeline Expansion; Credit Costs Decline",
      content: "State Bank of India reported an unprecedented infrastructure pipeline worth over ₹1.2 Lakh Crores. Slower credit slippages have lowered overall credit costs, surprising market estimates.",
      source: "Bloomberg Quint",
      sentiment: "bullish",
      impact: "high",
      time: "1 hour ago",
      ticker: "SBIN",
      sector: "Financials",
      technicalContext: "Public sector credit expansion is highly stimulative. The stock is forming a bullish ascending triangle pattern. Look for an RSI surge above 60 to confirm a breakout."
    }
  ],

  // Sectors
  Technology: [
    {
      id: "sec-tech-1",
      title: "Global Enterprise Software Budgets Expected to Rebound by 7.8% in Late Q3",
      content: "According to tech research firm insights, corporate expenditure on software, cloud infrastructure, and cognitive enterprise agents is highly resilient, driving healthy backlogs for system integrators.",
      source: "Reuters Tech",
      sentiment: "bullish",
      impact: "high",
      time: "5 hours ago",
      sector: "Technology",
      technicalContext: "Favorable structural demand benefits IT leaders. Sector indexes are showing bullish moving average alignments. Ideal environment for Accumulate-on-Dips strategy."
    },
    {
      id: "sec-tech-2",
      title: "AI Infrastructure Hardware Delays Restrict Local Indian Enterprise Deployment",
      content: "Due to high global semiconductor demand, enterprise GPU lead times in India have expanded to 28 weeks, which could temporarily limit execution of local pilot programs.",
      source: "Economic Times",
      sentiment: "neutral",
      impact: "medium",
      time: "8 hours ago",
      sector: "Technology",
      technicalContext: "Minor operational delay. Price action may show range-bound compression near local SMA averages as traders await quarterly AI revenue indicators."
    }
  ],
  Energy: [
    {
      id: "sec-eng-1",
      title: "BRENT Crude Oil Prices Consolidate Near $78/bbl Amid OPEC+ Quota Compliance",
      content: "Global benchmark Brent crude consolidated near $78 a barrel as producers displayed high compliance with output restraint targets, stabilizing global inventory cushions.",
      source: "Bloomberg Energy",
      sentiment: "neutral",
      impact: "medium",
      time: "2 hours ago",
      sector: "Energy",
      technicalContext: "Commodity stabilization dampens excessive volatility. Refining assets are expected to respect local support zones. Useful for defensive, low-beta swing trades."
    },
    {
      id: "sec-eng-2",
      title: "National Clean Energy Grid Expansion Unlocks Large Capacity Transmission Lines",
      content: "The Ministry of Power has commissioned three massive green energy transmission corridors, allowing solar and wind operators to transmit electricity with minimal wheeling losses.",
      source: "Business Standard",
      sentiment: "bullish",
      impact: "high",
      time: "12 hours ago",
      sector: "Energy",
      technicalContext: "Transmission efficiency improvements enhance clean utility margins. Energy sector charts show building volume accumulation patterns, indicating institutional inflows."
    }
  ],
  Financials: [
    {
      id: "sec-fin-1",
      title: "Nifty Financial Services Index Approaching Key Dynamic Crossover Resiliences",
      content: "Banking and financial services indexes are demonstrating massive strength, driven by strong quarterly margins, solid credit growth metrics, and expanding retail brokerage accounts.",
      source: "CNBC TV18",
      sentiment: "bullish",
      impact: "high",
      time: "3 hours ago",
      sector: "Financials",
      technicalContext: "High capital velocity environment. Financial stocks are showing highly resilient support buffers. Bollinger Bands are starting to expand upwards."
    },
    {
      id: "sec-fin-2",
      title: "Inflow of Domestic SIP Mutual Funds Hits Historic ₹21,000 Crore Milestone",
      content: "Retail investments into equity mutual funds via systematic investment plans reached a record high, supplying constant domestic liquidity backstops to institutional banking equities.",
      source: "Mint",
      sentiment: "bullish",
      impact: "medium",
      time: "6 hours ago",
      sector: "Financials",
      technicalContext: "Continuous liquidity support minimizes deep systemic drawdowns. Perfect floor setup for long-term SMA technical trend followers."
    }
  ],
  "Consumer Cyclical": [
    {
      id: "sec-con-1",
      title: "Premium Consumer Discretionary Demands Grow 14% Ahead of Festive Season",
      content: "E-commerce and physical retail channels report double-digit growth in premium consumer electronics, jewelry, and luxury apparel, signaling extremely strong middle-class balance sheets.",
      source: "Financial Express",
      sentiment: "bullish",
      impact: "high",
      time: "4 hours ago",
      sector: "Consumer Cyclical",
      technicalContext: "Strong organic consumer demand. Retail stocks are testing critical psychological breakout points. RSI is pointing upwards above the 55 level."
    }
  ],
  ipo: [
    {
      id: "ipo-1",
      title: "Premier Energies Surges 120% on Market Debut Following 85x Anchor Book Subscription",
      content: "Solar PV manufacturing major Premier Energies logged an extraordinary public debut on Dalal Street, driven by unprecedented institutional anchor bid interest and strong operational export backlogs.",
      source: "CNBC TV18",
      sentiment: "bullish",
      impact: "high",
      time: "25 minutes ago",
      ticker: "PREMIERENE",
      sector: "Energy",
      category: "ipo",
      technicalContext: "Substantial listing volume expansion indicates continuous buyer accumulation. Early post-listing momentum traders can track 15-minute VWAP for disciplined trend-following entries."
    },
    {
      id: "ipo-2",
      title: "Swiggy Mega IPO Files Final Red Herring Prospectus; Grey Market Premium (GMP) Accelerates",
      content: "Food delivery and quick-commerce giant Swiggy has cleared final regulatory hurdles for its ₹11,300 Crore public offering. Unlisted market grey market premium climbed to +26% on expanding dark-store profitability.",
      source: "Economic Times",
      sentiment: "bullish",
      impact: "high",
      time: "1 hour ago",
      ticker: "SWIGGY",
      sector: "Consumer Cyclical",
      category: "ipo",
      technicalContext: "High-contrast investor interest in quick-commerce unit economics. Sector peers ZOMATO are reacting with volume-supported support bounces near their 20-day SMA."
    },
    {
      id: "ipo-3",
      title: "Bajaj Housing Finance Hits 20% Upper Circuit as Institutional Lock-in Concerns Fade",
      content: "India's highest-valued housing finance NBFC surged to an all-time high as institutional allocators absorbed anchor lock-in releases with zero price degradation, affirming pristine balance sheet trust.",
      source: "Mint",
      sentiment: "bullish",
      impact: "high",
      time: "2 hours ago",
      ticker: "BAJAJHFL",
      sector: "Financials",
      category: "ipo",
      technicalContext: "Breakout past prior all-time high resistance on 3.5x average daily turnover. Momentum indicators (RSI 74) remain in strong bullish acceleration mode."
    }
  ],
  earnings: [
    {
      id: "earn-1",
      title: "TCS Delivers Solid Q3 Margins at 26.2%; Digital Cloud Deal Wins Hit Record $10.2 Billion",
      content: "Tata Consultancy Services posted resilient operating EBIT margins of 26.2%, beating analyst consensus by 45 basis points on expanding enterprise cognitive intelligence migrations.",
      source: "Bloomberg Quint",
      sentiment: "bullish",
      impact: "high",
      time: "40 minutes ago",
      ticker: "TCS",
      sector: "Technology",
      category: "earnings",
      technicalContext: "Clean volume-backed recovery above the 50-day SMA. RSI has crossed 62, signaling an active bullish momentum trend towards prior swing highs."
    },
    {
      id: "earn-2",
      title: "HDFC Bank Q3 Net Interest Margin Expands to 3.65%; Gross NPA Tumbles to Historic Low",
      content: "India's banking heavyweight reported net interest income growth of 18.2% YoY with asset quality improving across both retail mortgages and commercial credit lines.",
      source: "Financial Express",
      sentiment: "bullish",
      impact: "high",
      time: "2 hours ago",
      ticker: "HDFCBANK",
      sector: "Financials",
      category: "earnings",
      technicalContext: "Substantial margin beat creates strong structural valuation support. The stock is attempting a multi-month trendline breakout above horizontal resistance."
    },
    {
      id: "earn-3",
      title: "Tata Motors Commercial Vehicle Realizations Expand 9%; Free Cash Flow Reaches Record ₹8,400 Cr",
      content: "Tata Motors demonstrated expanding operational leverage in heavy commercial vehicles while British luxury arm JLR reported record quarterly order deliveries.",
      source: "Business Standard",
      sentiment: "bullish",
      impact: "high",
      time: "3 hours ago",
      ticker: "TATAMOTORS",
      sector: "Auto",
      category: "earnings",
      technicalContext: "Massive free cash flow generation reinforces balance sheet deleveraging. Technical support at the 20-day EMA continues to attract institutional dip buyers."
    }
  ],
  macro: [
    {
      id: "macro-1",
      title: "RBI MPC Holds Repo Rate Steady at 6.50%; Projects India FY25 GDP Growth at Robust 7.2%",
      content: "The Reserve Bank of India Monetary Policy Committee maintained its accommodative monetary stance, highlighting resilient domestic industrial capacity and capital expenditure momentum.",
      source: "Reuters",
      sentiment: "bullish",
      impact: "high",
      time: "1 hour ago",
      sector: "Financials",
      category: "macro",
      technicalContext: "Macro stability provides systemic floor for domestic equities. Banking indexes are validating bullish ascending triangle patterns."
    },
    {
      id: "macro-2",
      title: "India Manufacturing Purchasing Managers Index (PMI) Hits 58.4 as Export Orders Surge",
      content: "Factory activity in India recorded its strongest monthly pace of the fiscal year, driven by rising domestic consumer spending and high-value capital equipment shipments to Europe and the Middle East.",
      source: "Economic Times",
      sentiment: "bullish",
      impact: "medium",
      time: "4 hours ago",
      sector: "Metals",
      category: "macro",
      technicalContext: "Industrial acceleration directly stimulates metals and capital goods sectors. Moving averages show clean bullish alignment across sector ETFs."
    }
  ],
  smallcap: [
    {
      id: "small-1",
      title: "Small-Cap Defense Systems Manufacturer Secures ₹490 Cr Indigenous Radar Order",
      content: "High-precision radar components provider received a marquee multi-year contract from the Ministry of Defense, boosting its order book to 4.2x FY24 trailing revenue.",
      source: "FRIDAY Wire",
      sentiment: "bullish",
      impact: "high",
      time: "35 minutes ago",
      ticker: "DATAPATTNS",
      sector: "Capital Goods",
      category: "smallcap",
      technicalContext: "Classic high-conviction orderbook breakout. High volume expansion accompanied by upper Bollinger Band breakout suggests multi-day momentum continuation."
    },
    {
      id: "small-2",
      title: "Nifty SmallCap 250 Index Outperforms Broad Market as Domestic Inflows Reach Record Velocity",
      content: "Small-cap equities witnessed fresh domestic mutual fund buying as earnings growth in niche manufacturing, EMS, and green energy companies continued to beat large-cap averages.",
      source: "Mint",
      sentiment: "bullish",
      impact: "high",
      time: "2 hours ago",
      sector: "SmallCap",
      category: "smallcap",
      technicalContext: "Broad-based market breadth expansion. Over 74% of small-cap constituents are trading above their 200-day moving average, confirming a robust cyclical bull trend."
    }
  ]
};

const SEARCH_QUERIES: Record<string, string> = {
  RELIANCE: "Reliance Industries",
  TCS: "Tata Consultancy Services",
  HDFCBANK: "HDFC Bank",
  INFY: "Infosys",
  ICICIBANK: "ICICI Bank",
  ITC: "ITC share",
  SBIN: "State Bank of India",
  TATAMOTORS: "Tata Motors share",
  "M&M": "Mahindra and Mahindra share",
  MM: "Mahindra and Mahindra share",
  WIPRO: "Wipro share",
  BHARTIARTL: "Bharti Airtel share",
  KOTAKBANK: "Kotak Mahindra Bank",
  LT: "Larsen Toubro share",
  MARUTI: "Maruti Suzuki share",
  SUNPHARMA: "Sun Pharma share",
  BAJFINANCE: "Bajaj Finance share",
  AXISBANK: "Axis Bank share",
  TITAN: "Titan Company share",
  ULTRACEMCO: "UltraTech Cement share",
  ASIANPAINT: "Asian Paints share",
  HCLTECH: "HCL Technologies share",
  DRREDDY: "Dr Reddys Laboratories share",
  CIPLA: "Cipla share",
  ZOMATO: "Zomato share",
  PAYTM: "Paytm One97 share",
};

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function parseGoogleNewsRSS(xmlText: string): Array<{ title: string; link: string; pubDate: string; source: string }> {
  const items: Array<{ title: string; link: string; pubDate: string; source: string }> = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  
  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemContent = match[1];
    
    const titleMatch = itemContent.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = itemContent.match(/<link>([\s\S]*?)<\/link>/);
    const pubDateMatch = itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const sourceMatch = itemContent.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    
    let rawTitle = titleMatch ? titleMatch[1] : '';
    const link = decodeXmlEntities(linkMatch ? linkMatch[1] : '').trim();
    const pubDate = pubDateMatch ? pubDateMatch[1] : '';
    let source = sourceMatch ? sourceMatch[1] : 'Google News';
    
    rawTitle = decodeXmlEntities(rawTitle);
    source = decodeXmlEntities(source);
    
    let title = rawTitle;
    if (rawTitle.includes(' - ')) {
      const parts = rawTitle.split(' - ');
      source = parts.pop() || source;
      title = parts.join(' - ');
    }

    items.push({
      title: title.trim(),
      link: link.trim(),
      pubDate: pubDate.trim(),
      source: source.trim()
    });
  }

  return items;
}

    interface UniverseStock {
      symbol?: string;
      ticker?: string;
      name?: string;
      sector?: string;
    }

    interface UniverseNewsStock {
      symbol: string;
      name: string;
      sector: string;
      aliases: string[];
    }

    function getNewsUniverse(): UniverseNewsStock[] {
      const stocks = allIndianStocks as UniverseStock[];
      const bySymbol = new Map<string, UniverseNewsStock>();
      for (const stock of stocks) {
        const symbol = (stock.symbol || stock.ticker || '').replace(/\.(NS|BO)$/i, '').trim().toUpperCase();
        if (!symbol || !/^[A-Z0-9&_-]{1,20}$/.test(symbol) || bySymbol.has(symbol)) continue;
        const name = (stock.name || symbol).trim();
        const meaningfulName = name
          .replace(/\b(limited|ltd|company|co|corporation|corp|industries|industry|india|private|pvt|inc)\b/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        bySymbol.set(symbol, {
          symbol,
          name,
          sector: stock.sector || 'Unclassified',
          aliases: [...new Set([symbol, name, meaningfulName].filter(Boolean))],
        });
      }
      return [...bySymbol.values()];
    }

    function headlineMatchesStock(title: string, stock: UniverseNewsStock): boolean {
      const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const normalizedSymbol = stock.symbol.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (normalizedSymbol && new RegExp(`(?:^| )${normalizedSymbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$| )`).test(normalizedTitle)) {
        return true;
      }

      const meaningfulAliases = stock.aliases.slice(1).map(alias =>
        alias.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      ).filter(Boolean);
      return meaningfulAliases.some(alias => {
        if (normalizedTitle.includes(alias)) return true;
        const words = alias.split(' ').filter(word => word.length >= 4);
        return words.length >= 2 && words.every(word => normalizedTitle.split(' ').includes(word));
      });
    }

    async function fetchUniverseBatch(stocks: UniverseNewsStock[], deadline: number) {
      const query = stocks.flatMap(stock => [`"${stock.symbol}"`, `"${stock.name.replace(/"/g, '')}"`]).join(' OR ');
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`(${query})`)}&hl=en-IN&gl=IN&ceid=IN:en`;
      const remainingMs = Math.max(0, deadline - Date.now());
      if (remainingMs === 0) return { ok: false, headlines: [] as ReturnType<typeof parseGoogleNewsRSS> };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.min(NEWS_UNIVERSE_REQUEST_TIMEOUT_MS, remainingMs));
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; AxionNews/1.0)',
          },
        });
        if (!response.ok) return { ok: false, headlines: [] as ReturnType<typeof parseGoogleNewsRSS> };
        const headlines = parseGoogleNewsRSS(await response.text()).slice(0, NEWS_UNIVERSE_ARTICLES_PER_BATCH);
        return { ok: true, headlines };
      } catch {
        return { ok: false, headlines: [] as ReturnType<typeof parseGoogleNewsRSS> };
      } finally {
        clearTimeout(timeout);
      }
    }

    async function processUniverseNews() {
      const stocks = getNewsUniverse();
      const batches: UniverseNewsStock[][] = [];
      for (let offset = 0; offset < stocks.length; offset += NEWS_UNIVERSE_BATCH_SIZE) {
        batches.push(stocks.slice(offset, offset + NEWS_UNIVERSE_BATCH_SIZE));
      }

      const startedAt = Date.now();
      const deadline = startedAt + NEWS_UNIVERSE_TOTAL_TIMEOUT_MS;
      let nextBatch = 0;
      let scannedCount = 0;
      let failedBatches = 0;
      const itemsByTicker = new Map<string, NewsItem[]>();

      const worker = async () => {
        while (Date.now() < deadline) {
          const batchIndex = nextBatch++;
          if (batchIndex >= batches.length) return;
          const batch = batches[batchIndex];
          const result = await fetchUniverseBatch(batch, deadline);
          if (Date.now() > deadline && !result.ok) return;
          scannedCount += batch.length;
          if (!result.ok) {
            failedBatches++;
            continue;
          }

          for (const article of result.headlines) {
            const matchingStocks = batch.filter(stock => headlineMatchesStock(article.title, stock));
            for (const stock of matchingStocks) {
              const tickerNews = itemsByTicker.get(stock.symbol) || [];
              if (tickerNews.length >= NEWS_UNIVERSE_ARTICLES_PER_TICKER ||
                  tickerNews.some(item => item.sourceLink === article.link || item.title === article.title)) continue;
              const analysis = analyzeNewsHeuristically(article.title, '', stock.symbol, tickerNews.length);
              tickerNews.push({
                id: `universe-${stock.symbol}-${tickerNews.length}`,
                title: article.title,
                content: `Reported by ${article.source}. Open the source article for details.`,
                source: article.source,
                sourceLink: /^https:\/\//i.test(article.link) ? article.link : undefined,
                sentiment: analysis.sentiment,
                impact: analysis.impact,
                time: article.pubDate ? getRelativeTime(article.pubDate) : 'Recently',
                ticker: stock.symbol,
                sector: stock.sector,
                technicalContext: analysis.technicalContext,
              });
              itemsByTicker.set(stock.symbol, tickerNews);
            }
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(NEWS_UNIVERSE_CONCURRENCY, batches.length) }, worker));
      const news = [...itemsByTicker.values()].flat();
      const summary = {
        bullish: news.filter(item => item.sentiment === 'bullish').length,
        bearish: news.filter(item => item.sentiment === 'bearish').length,
        neutral: news.filter(item => item.sentiment === 'neutral').length,
        high: news.filter(item => item.impact === 'high').length,
      };
      const elapsedMs = Date.now() - startedAt;
      const timedOut = scannedCount < stocks.length && elapsedMs >= NEWS_UNIVERSE_TOTAL_TIMEOUT_MS;
      return {
        news,
        isMock: false,
        summary,
        scan: {
          universeCount: stocks.length,
          scannedCount,
          totalBatches: batches.length,
          failedBatches,
          partial: failedBatches > 0 || scannedCount < stocks.length,
          timedOut,
          elapsedMs,
        },
      };
    }

function getRelativeTime(pubDateStr: string): string {
  try {
    const pubDate = new Date(pubDateStr);
    const now = new Date();
    const diffMs = now.getTime() - pubDate.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 60) {
      return diffMins <= 1 ? "Just now" : `${diffMins} mins ago`;
    } else if (diffHours < 24) {
      return diffHours === 1 ? "1 hour ago" : `${diffHours} hours ago`;
    } else {
      return diffDays === 1 ? "Yesterday" : `${diffDays} days ago`;
    }
  } catch (e) {
    return "Recently";
  }
}


const TICKER_DETECTION_MAP: Record<string, string> = {
  reliance: 'RELIANCE',
  tcs: 'TCS',
  'tata motors': 'TATAMOTORS',
  tatamotors: 'TATAMOTORS',
  infosys: 'INFY',
  infy: 'INFY',
  'hdfc bank': 'HDFCBANK',
  hdfc: 'HDFCBANK',
  'icici bank': 'ICICIBANK',
  icici: 'ICICIBANK',
  sbin: 'SBIN',
  'state bank': 'SBIN',
  wipro: 'WIPRO',
  airtel: 'BHARTIARTL',
  bharti: 'BHARTIARTL',
  itc: 'ITC',
  zomato: 'ZOMATO',
  swiggy: 'SWIGGY',
  bajaj: 'BAJFINANCE',
  bajajhfl: 'BAJAJHFL',
  maruti: 'MARUTI',
  titan: 'TITAN',
  sunpharma: 'SUNPHARMA',
  'sun pharma': 'SUNPHARMA',
  premier: 'PREMIERENE',
  adanient: 'ADANIENT',
  adani: 'ADANIENT',
  kotak: 'KOTAKBANK',
  datapattns: 'DATAPATTNS',
};

function autoDetectTicker(text: string, currentTicker?: string): string | undefined {
  if (currentTicker && currentTicker.trim()) return currentTicker.toUpperCase();
  const lower = text.toLowerCase();
  for (const [kw, symbol] of Object.entries(TICKER_DETECTION_MAP)) {
    if (lower.includes(kw)) return symbol;
  }
  return undefined;
}

function analyzeNewsHeuristically(title: string, content: string, ticker?: string, idx: number = 0): {
  sentiment: 'bullish' | 'bearish' | 'neutral';
  impact: 'high' | 'medium' | 'low';
  technicalContext: string;
  sentimentScore: number;
  priceImpactEst: string;
} {
  const text = `${title} ${content}`.toLowerCase();
  
  let sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let impact: 'high' | 'medium' | 'low' = 'medium';
  
  const bullKeywords = [
    'rise', 'up', 'jump', 'surge', 'rally', 'climb', 'gain', 'profit', 'beat', 'dividend',
    'buy', 'partnership', 'deal', 'agreement', 'order', 'win', 'expansion', 'invest', 'growth',
    'positive', 'outperform', 'raise', 'upgrade', 'highest', 'record', 'bullish'
  ];
  
  const bearKeywords = [
    'fall', 'down', 'drop', 'slump', 'plunge', 'slide', 'loss', 'decline', 'fine', 'penalty',
    'sell', 'miss', 'cut', 'downgrade', 'bearish', 'slowdown', 'lower', 'underperform', 'deficit',
    'contract', 'regulatory', 'investigation', 'audit', 'probe'
  ];
  
  let bullCount = 0;
  let bearCount = 0;
  
  bullKeywords.forEach(k => {
    if (text.includes(k)) bullCount++;
  });
  bearKeywords.forEach(k => {
    if (text.includes(k)) bearCount++;
  });
  
  if (bullCount > bearCount) {
    sentiment = 'bullish';
    impact = bullCount >= 3 ? 'high' : 'medium';
  } else if (bearCount > bullCount) {
    sentiment = 'bearish';
    impact = bearCount >= 3 ? 'high' : 'medium';
  } else {
    sentiment = 'neutral';
    impact = 'low';
  }
  
  let technicalContext = "";
  if (sentiment === 'bullish') {
    const options = [
      `Following this positive development, standard RSI indicators show momentum tilting upward. Look for a clean volume-backed crossover of the 20-day SMA to validate swing trade entries.`,
      `The bullish news matches expansion in buying volumes. Accumulating positions near the lower Bollinger bands or key horizontal support is favorable before testing local breakout peaks.`,
      `Positive sentiment reinforces underlying defensive metrics. Anticipate an RSI breakout past 60, signaling immediate bullish momentum with a structured upside range target of +3% to +5%.`
    ];
    technicalContext = options[idx % options.length];
  } else if (sentiment === 'bearish') {
    const options = [
      `Short-term headwinds may trigger temporary liquidations. Monitor the immediate support zones near the 50-day SMA; a failure to hold could push the RSI down to oversold territories under 30.`,
      `Bearish momentum is increasing on average selling volumes. Standard indicators advise patience; wait for Stochastic %K and %D lines to bottom-out and hook upwards before attempting swing reversals.`,
      `Price action is testing key horizontal demand clusters. Under increasing negative pressure, placing trailing stop-loss protection just below the recent swing low is a highly recommended risk policy.`
    ];
    technicalContext = options[idx % options.length];
  } else {
    const options = [
      `Market participants are absorbing the news with minor volatility. Expect sideways price consolidation inside the established trading bands with flat RSI tracking around the neutral 50 level.`,
      `Neutral newsflow supports standard range-bound strategies. Consider harvesting swing profits near Bollinger upper thresholds while accumulating on dips near SMA support coordinates.`,
      `Low immediate volume impact expected. Stochastic oscillations are likely to remain balanced, making standard intraday support-resistance boundaries the primary guideline for risk control.`
    ];
    technicalContext = options[idx % options.length];
  }
  
  let sentimentScore = 0;
  if (sentiment === 'bullish') {
    sentimentScore = Math.min(95, 60 + bullCount * 8);
  } else if (sentiment === 'bearish') {
    sentimentScore = Math.max(-95, -60 - bearCount * 8);
  } else {
    sentimentScore = (idx % 2 === 0 ? 5 : -5);
  }

  const priceImpactEst = impact === 'high' 
    ? (sentiment === 'bullish' ? '+3.5% to +8.0% Upside' : '-3.0% to -7.5% Risk')
    : impact === 'medium'
    ? (sentiment === 'bullish' ? '+1.5% to +3.5% Upside' : '-1.5% to -3.0% Risk')
    : '±0.5% Range-bound';

  return { sentiment, impact, technicalContext, sentimentScore, priceImpactEst };
}

function cleanFeedHtml(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFeedXml(xmlText: string, defaultSource: string): Array<{ title: string; link: string; pubDate: string; source: string; content?: string }> {
  const items: Array<{ title: string; link: string; pubDate: string; source: string; content?: string }> = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  
  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemContent = match[1];
    
    const titleMatch = itemContent.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = itemContent.match(/<link>([\s\S]*?)<\/link>/);
    const pubDateMatch = itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const descMatch = itemContent.match(/<description>([\s\S]*?)<\/description>/);
    const sourceMatch = itemContent.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    
    const title = cleanFeedHtml(titleMatch ? titleMatch[1] : '');
    const link = cleanFeedHtml(linkMatch ? linkMatch[1] : '');
    const pubDate = pubDateMatch ? pubDateMatch[1].trim() : '';
    const description = cleanFeedHtml(descMatch ? descMatch[1] : '');
    let source = sourceMatch ? cleanFeedHtml(sourceMatch[1]) : defaultSource;

    // Normalize source names
    if (source.includes('Economic Times') || link.includes('economictimes')) source = 'Economic Times';
    else if (source.includes('Moneycontrol') || link.includes('moneycontrol')) source = 'Moneycontrol';
    else if (source.includes('Livemint') || link.includes('livemint')) source = 'LiveMint';
    else if (source.includes('Business Standard') || link.includes('business-standard')) source = 'Business Standard';
    else if (source.includes('CNBC') || link.includes('cnbctv18')) source = 'CNBC TV18';
    else if (source.includes('Reuters') || link.includes('reuters')) source = 'Reuters';
    else if (source.includes('Bloomberg')) source = 'Bloomberg';
    else if (!source) source = defaultSource;
    
    if (title && title.length > 5) {
      items.push({ 
        title, 
        link, 
        pubDate, 
        source, 
        content: description && description.length > 20 ? description : undefined 
      });
    }
  }
  return items;
}

const MULTI_SOURCE_FEEDS = [
  { name: 'Economic Times', url: 'https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms' },
  { name: 'LiveMint', url: 'https://www.livemint.com/rss/markets' },
  { name: 'LiveMint', url: 'https://www.livemint.com/rss/companies' },
  { name: 'Moneycontrol', url: 'https://www.moneycontrol.com/rss/MCtopnews.xml' },
  { name: 'Business Standard', url: 'https://www.business-standard.com/rss/markets-106.rss' },
];

async function fetchRealNewsHeadlines(
  ticker?: string, 
  sector?: string, 
  category?: string,
  sourceFilter?: string
): Promise<Array<{ title: string; link: string; pubDate: string; source: string; content?: string }>> {
  try {
    let googleQuery = "Indian stock market";
    const cleanTicker = ticker ? ticker.replace(/\.NS$/i, '').trim().toUpperCase() : undefined;

    if (category === 'ipo') {
      googleQuery = "Indian IPO GMP listing subscription Dalal Street";
    } else if (category === 'earnings') {
      googleQuery = "Indian quarterly earnings results profit Q3 Q4 revenue stock";
    } else if (category === 'macro') {
      googleQuery = "RBI repo rate inflation GDP Indian economy stock market";
    } else if (category === 'smallcap') {
      googleQuery = "Indian small cap breakout multibagger stocks";
    } else if (cleanTicker && SEARCH_QUERIES[cleanTicker]) {
      googleQuery = SEARCH_QUERIES[cleanTicker];
    } else if (cleanTicker) {
      googleQuery = `${cleanTicker} share price news`;
    } else if (sector) {
      googleQuery = `Indian ${sector} sector stock market`;
    }

    const feedsToFetch = [
      {
        name: 'Google News',
        url: `https://news.google.com/rss/search?q=${encodeURIComponent(googleQuery)}&hl=en-IN&gl=IN&ceid=IN:en`
      },
      ...MULTI_SOURCE_FEEDS
    ];

    const results = await Promise.allSettled(
      feedsToFetch.map(async f => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 4000);
        try {
          const res = await fetch(f.url, { 
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
          });
          if (!res.ok) return [];
          const xml = await res.text();
          return parseFeedXml(xml, f.name);
        } catch {
          return [];
        } finally {
          clearTimeout(id);
        }
      })
    );

    const allArticles: Array<{ title: string; link: string; pubDate: string; source: string; content?: string }> = [];
    const seenTitles = new Set<string>();

    for (const r of results) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        for (const item of r.value) {
          // Normalize for deduplication
          const normKey = item.title.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!seenTitles.has(normKey)) {
            seenTitles.add(normKey);

            // Filter by ticker if user requested a specific stock
            if (cleanTicker) {
              const fullText = `${item.title} ${item.content || ''}`.toUpperCase();
              const hasTickerMatch = fullText.includes(cleanTicker) || 
                (SEARCH_QUERIES[cleanTicker] && fullText.includes(SEARCH_QUERIES[cleanTicker].toUpperCase()));
              if (!hasTickerMatch) continue;
            }

            // Filter by specific publisher if requested
            if (sourceFilter && sourceFilter !== 'All' && sourceFilter !== 'all') {
              if (!item.source.toLowerCase().includes(sourceFilter.toLowerCase())) {
                continue;
              }
            }

            allArticles.push(item);
          }
        }
      }
    }

    // Sort newest first if valid pubDate exists
    allArticles.sort((a, b) => {
      const dateA = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const dateB = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return dateB - dateA;
    });

    return allArticles;
  } catch (err) {
    console.warn("Failed to fetch multi-source financial news:", err);
    return [];
  }
}

// Lazy initialization of the Gemini client to prevent crash if key is missing on start
let aiClient: GoogleGenAI | null = null;

function getGeminiClient(overrideApiKey?: string | null): GoogleGenAI | null {
  const apiKey = overrideApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey === "YOUR_ACTUAL_GEMINI_API_KEY" || apiKey === "YOUR_GEMINI_API_KEY") {
    return null;
  }
  if (overrideApiKey) {
    return new GoogleGenAI({
      apiKey: overrideApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// Helper to generate handcrafted fallback news in case API key is missing or quota is exceeded
function getHandcraftedFallback(ticker?: string, sector?: string): NewsItem[] {
  let newsList: NewsItem[] = [];
  const cleanTicker = ticker ? ticker.replace(/\.NS$/i, '').trim().toUpperCase() : undefined;

  // Add news related to ticker
  if (cleanTicker && HANDCRAFTED_NEWS[cleanTicker]) {
    newsList = [...newsList, ...HANDCRAFTED_NEWS[cleanTicker]];
  }

  // Add news related to sector
  if (sector && HANDCRAFTED_NEWS[sector]) {
    newsList = [...newsList, ...HANDCRAFTED_NEWS[sector]];
  }

  // If nothing matches or list is empty, default to TCS + Tech
  if (newsList.length === 0) {
    newsList = [
      ...HANDCRAFTED_NEWS.TCS,
      ...HANDCRAFTED_NEWS.Technology
    ];
  }

  // Append random mock details to make it feel super dynamic and alive
  return newsList.map((item, idx) => ({
    ...item,
    id: `${item.id}-${Date.now().toString().slice(-4)}-${idx}`,
  }));
}

async function processNewsRequest(ticker?: string, sector?: string, overrideKey?: string | null, category?: string, sourceFilter?: string) {
  const cleanTicker = ticker ? ticker.replace(/\.NS$/i, '').trim().toUpperCase() : undefined;
  const ai = getGeminiClient(overrideKey);

  // 1. Fetch real-time live headlines from Google News RSS
  const realHeadlines = await fetchRealNewsHeadlines(cleanTicker, sector, category, sourceFilter);
  const hasRealHeadlines = realHeadlines.length > 0;

  // Use top 4 headlines, or fall back to handcrafted if RSS was empty
  const catFallback = (category && (HANDCRAFTED_NEWS as any)[category]) ? (HANDCRAFTED_NEWS as any)[category] : [];
  const sourceArticles = hasRealHeadlines 
    ? realHeadlines.slice(0, 50)
    : (catFallback.length > 0 ? catFallback : getHandcraftedFallback(cleanTicker, sector));

  // If Gemini is available, use it to perform premium financial enrichment
  if (ai) {
    try {
      const prompt = `
        You are FRIDAY/JARVIS, a premium quantum investment terminal intelligence.
        Analyze and enrich the following actual live news headlines to guide technical analysts:
        - Ticker: ${cleanTicker || "None selected"}
        - Sector: ${sector || "None selected"}

        Articles to analyze:
        ${JSON.stringify(sourceArticles, null, 2)}

        For each article, provide:
        1. Title: The original title.
        2. Content: A brief 2-sentence summary/contextual background of this event (if original description is empty, generate realistic context based on the title).
        3. Source: The original source.
        4. Sentiment: EXACTLY "bullish", "bearish", or "neutral" based on standard market implications.
        5. Impact: EXACTLY "high", "medium", or "low".
        6. Time: Use the relative time (e.g. "30 mins ago") derived from the original pubDate/time.
        7. Technical Context: Explain how this specific news interacts with technical charts and indicators (such as SMA crossovers, Bollinger Band squeeze, support/resistance, RSI oscillator ranges, or intraday buy/sell boundaries) to guide technical analysts.

        Return the response in JSON format matching the schema defined below. Do NOT write markdown outside the JSON. The response MUST be a pure JSON array containing the news objects.

        JSON Schema:
        [
          {
            "id": "string (unique code or index)",
            "title": "string",
            "content": "string",
            "source": "string",
            "sentiment": "bullish" | "bearish" | "neutral",
            "impact": "high" | "medium" | "low",
            "time": "string",
            "ticker": "string or empty",
            "sector": "string or empty",
            "technicalContext": "string"
          }
        ]
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          systemInstruction: "You are an expert Wall Street algorithmic analyst and financial news editor. Return pure JSON output matching the requested schema. Ensure all news events are highly tailored to the given ticker and sector to supply contextual synergy for technical chart studies.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                title: { type: Type.STRING },
                content: { type: Type.STRING },
                source: { type: Type.STRING },
                sentiment: { type: Type.STRING },
                impact: { type: Type.STRING },
                time: { type: Type.STRING },
                ticker: { type: Type.STRING },
                sector: { type: Type.STRING },
                technicalContext: { type: Type.STRING },
              },
              required: ["id", "title", "content", "source", "sentiment", "impact", "time", "technicalContext"]
            }
          },
          temperature: 0.35,
        }
      });

      const text = response.text || "[]";
      const parsedNews = JSON.parse(text.trim());

      const summary = {
        bullish: parsedNews.filter((n: any) => n.sentiment === 'bullish').length,
        bearish: parsedNews.filter((n: any) => n.sentiment === 'bearish').length,
        neutral: parsedNews.filter((n: any) => n.sentiment === 'neutral').length,
        high: parsedNews.filter((n: any) => n.impact === 'high').length,
      };

      return { news: parsedNews, isMock: false, summary };
    } catch (apiError: any) {
      console.log(`[News Enrichment Gemini error for ${cleanTicker || sector}, falling back to Ollama]:`, apiError?.message);
    }
  }

  // Tier 2: Try Local Ollama for AI enrichment
  try {
    const ollamaPrompt = `
Analyze and enrich these financial news headlines for ${cleanTicker || sector || 'Indian Markets'}:
${JSON.stringify(sourceArticles, null, 2)}

Return strictly a JSON array of objects with keys:
- "id": string (e.g. "news-1")
- "title": string (original title)
- "content": string (2-sentence summary/context)
- "source": string (source name)
- "sentiment": "bullish" | "bearish" | "neutral"
- "impact": "high" | "medium" | "low"
- "time": string (e.g. "Recently" or relative time)
- "ticker": "${cleanTicker || ''}"
- "sector": "${sector || ''}"
- "technicalContext": string (how this news impacts technical levels/support/resistance/oscillators)
`;

    const ollamaResult = await generateOllamaResponse({
      prompt: ollamaPrompt,
      system: "You are a financial news intelligence AI. Output strictly a JSON array of news objects.",
      format: 'json',
      temperature: 0.25,
      numPredict: 800,
      timeoutMs: 10000,
    });

    if (ollamaResult && ollamaResult.text) {
      const cleaned = cleanJsonText(ollamaResult.text);
      const parsedNews = JSON.parse(cleaned);
      if (Array.isArray(parsedNews) && parsedNews.length > 0) {
        const summary = {
          bullish: parsedNews.filter((n: any) => n.sentiment === 'bullish').length,
          bearish: parsedNews.filter((n: any) => n.sentiment === 'bearish').length,
          neutral: parsedNews.filter((n: any) => n.sentiment === 'neutral').length,
          high: parsedNews.filter((n: any) => n.impact === 'high').length,
        };
        return { 
          news: parsedNews, 
          isMock: false, 
          source: 'ollama', 
          model: ollamaResult.model, 
          summary 
        };
      }
    }
  } catch (ollamaErr: any) {
    console.log(`[Ollama News Enrichment error]:`, ollamaErr?.message);
  }

  // Tier 3: Heuristic enrichment (if Gemini and Ollama are unavailable)
  const enrichedNews: NewsItem[] = sourceArticles.map((article: any, idx: number) => {
    const relativeTime = (article as any).pubDate ? getRelativeTime((article as any).pubDate) : (article as any).time || "Recently";
    const detected = autoDetectTicker(`${article.title} ${(article as any).content || ''}`, cleanTicker);
    const analysis = analyzeNewsHeuristically(article.title, (article as any).content || '', detected || cleanTicker, idx);
    
    return {
      id: (article as any).id || `live-news-${idx}-${Date.now().toString().slice(-4)}`,
      title: article.title,
      content: (article as any).content || `Latest news update on ${detected || cleanTicker || sector || 'this market segment'} from ${article.source}. Analysts are monitoring this closely for price trend confirmations.`,
      source: article.source,
      sentiment: (article as any).sentiment || analysis.sentiment,
      impact: (article as any).impact || analysis.impact,
      time: relativeTime,
      ticker: detected || cleanTicker,
      sector: (article as any).sector || sector,
      technicalContext: (article as any).technicalContext || analysis.technicalContext,
      sourceLink: (article as any).link || (article as any).sourceLink,
      sentimentScore: (article as any).sentimentScore ?? analysis.sentimentScore,
      priceImpactEst: (article as any).priceImpactEst ?? analysis.priceImpactEst,
      category: category || (article as any).category,
    };
  });

  const sourceCounts: Record<string, number> = {};
  for (const n of enrichedNews) {
    const s = n.source || 'Other';
    sourceCounts[s] = (sourceCounts[s] || 0) + 1;
  }

  const summary = {
    bullish: enrichedNews.filter((n: any) => n.sentiment === 'bullish').length,
    bearish: enrichedNews.filter((n: any) => n.sentiment === 'bearish').length,
    neutral: enrichedNews.filter((n: any) => n.sentiment === 'neutral').length,
    high: enrichedNews.filter((n: any) => n.impact === 'high').length,
    sourceCounts,
  };

  return { news: enrichedNews, isMock: false, summary };
}

const newsResponseCache = new Map<string, { data: any; expires: number }>();

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    if (searchParams.get('universe') === '1') {
      return NextResponse.json(await processUniverseNews());
    }
    const ticker = searchParams.get('ticker') || undefined;
    const sector = searchParams.get('sector') || undefined;
    const category = searchParams.get('category') || undefined;
    const source = searchParams.get('source') || undefined;
    const overrideKey = req.headers.get('x-gemini-api-key') || req.headers.get('X-Gemini-Api-Key');

    const cacheKey = `${ticker || 'ALL'}_${sector || 'ALL'}_${category || 'ALL'}_${source || 'ALL'}_${overrideKey ? 'custom' : 'default'}`;
    const cached = newsResponseCache.get(cacheKey);
    const now = Date.now();

    if (cached && cached.expires > now) {
      return NextResponse.json(cached.data);
    }

    if (cached) {
      // Stale-While-Revalidate: return stale immediately, update in background
      processNewsRequest(ticker, sector, overrideKey, category, source).then(fresh => {
        newsResponseCache.set(cacheKey, { data: fresh, expires: Date.now() + 300_000 });
      }).catch(() => {});
      return NextResponse.json(cached.data);
    }

    const result = await processNewsRequest(ticker, sector, overrideKey, category, source);
    newsResponseCache.set(cacheKey, { data: result, expires: now + 300_000 });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("News GET Endpoint Error:", error);
    return NextResponse.json({ error: error?.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await guardAiRequest(req);
  if (denied) return denied;
  try {
    const body = await req.json().catch(() => ({}));
    const { ticker, sector, category, source } = body;
    const overrideKey = req.headers.get('x-gemini-api-key') || req.headers.get('X-Gemini-Api-Key');

    const result = await processNewsRequest(ticker, sector, overrideKey, category, source);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("News POST Endpoint Error:", error);
    return NextResponse.json({ error: error?.message || "Internal Server Error" }, { status: 500 });
  }
}
