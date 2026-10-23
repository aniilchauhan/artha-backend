import { STOCK_METADATA } from './stock-data';
import { fetchProviderChart, normalizeChart, quoteStatus, type QuoteProvenance } from './market-quote';

export const TICKER_NAMES: Record<string, string> = {
  RELIANCE: "Reliance Industries Ltd.",
  TCS: "Tata Consultancy Services Ltd.",
  HDFCBANK: "HDFC Bank Ltd.",
  INFY: "Infosys Ltd.",
  ICICIBANK: "ICICI Bank Ltd.",
  ITC: "ITC Ltd.",
  SBIN: "State Bank of India",
  BHARTIARTL: "Bharti Airtel Ltd.",
  LTM: "LTIMindtree Ltd.",
  LT: "Larsen & Tourbo Ltd.",
  KOTAKBANK: "Kotak Mahindra Bank Ltd.",
  HINDUNILVR: "Hindustan Unilever Ltd.",
  MARUTI: "Maruti Suzuki India Ltd.",
  TATASTEEL: "Tata Steel Ltd.",
  WIPRO: "Wipro Ltd.",
  AXISBANK: "Axis Bank Ltd.",
  ASIANPAINT: "Asian Paints Ltd.",
  "M&M": "Mahindra & Mahindra Ltd.",
  BAJFINANCE: "Bajaj Finance Ltd.",
  SUNPHARMA: "Sun Pharmaceutical Industries Ltd.",
  ADANIENT: "Adani Enterprises Ltd.",
  NTPC: "NTPC Ltd.",
  ONGC: "Oil & Natural Gas Corporation Ltd.",
  TITAN: "Titan Company Ltd.",
  TMCV: "Tata Motors Ltd. (Commercial Vehicles)",
  ETERNAL: "Eternal Industries Ltd.",
  CCAVENUE: "AvenuesAI Ltd.",
  IRCON: "Ircon International Ltd.",
  PFS: "PTC India Financial Services Ltd.",
  IRFC: "Indian Railway Finance Corporation Ltd.",
  SUZLON: "Suzlon Energy Ltd.",
  SWIGGY: "Swiggy Ltd.",
  JSWCEMENT: "JSW Cement Ltd.",
  IGIL: "International Gemological Institute Ltd.",
  DLINKINDIA: "D-Link (India) Ltd.",
  ITCHOTELS: "ITC Hotels Ltd.",
  TMPV: "Tata Motors Passenger Vehicles Ltd.",
  ATHERENERG: "Ather Energy Ltd.",
  RBA: "Restaurant Brands Asia Ltd.",
  DBEIL: "Deepak Builders & Engineers India Ltd.",
  GROWW: "Groww (Billionbrains Garage Ventures)",
  AFCONS: "Afcons Infrastructure Ltd.",
  HILINFRA: "Highway Infrastructure Limited",
  ABCAPITAL: "Aditya Birla Capital Ltd.",
  GOPAL: "Gopal Snacks Ltd.",
  JIOFIN: "Jio Financial Services Ltd.",
  OLAELEC: "Ola Electric Mobility Ltd.",
  INFOBEAN: "InfoBeans Technologies Ltd.",
  CPPLUS: "Aditya Infotech Ltd.",
  "NSDL.BO": "NSDL (National Securities Depository Ltd.)",
  EBGNG: "GNG Electronics Ltd.",
  VISHAL: "Vishal Mega Mart Ltd.",
  EIEL: "Enviro Infra Engineers Ltd.",
  ANTHEM: "Anthem Biosciences Ltd.",
  SALASAR: "Salasar Techno Engineering Ltd.",
  SHANTIGOLD: "Shanti Gold International Ltd.",
  MEESHO: "Meesho Ltd.",
  ANANTRAJ: "Anant Raj Ltd.",
  JWL: "Jupiter Wagons Ltd.",
  RPOWER: "Reliance Power Ltd.",
  NHPC: "NHPC Ltd.",
  IOB: "Indian Overseas Bank",
  GTLINFRA: "GTL Infrastructure Ltd.",
  PNB: "Punjab National Bank",
  ACMESOLAR: "Acme Solar Holdings Ltd.",
  PREMIERENE: "Premier Energies Ltd.",
  ABSLAMC: "Aditya Birla Sun Life AMC Ltd.",
  CANBK: "Canara Bank",
  IDEA: "Vodafone Idea Ltd.",
  DEVYANI: "Devyani International Ltd.",
  TATAPOWER: "Tata Power Company Ltd.",
  RVNL: "Rail Vikas Nigam Ltd.",
  CUPID: "Cupid Ltd.",
  MOREPENLAB: "Morepen Laboratories Ltd."
};

// Memory cache for stock data fetched in API
export interface CachedStock extends Partial<QuoteProvenance> {
  ticker: string;
  name: string;
  currentPrice: number;
  previousClose?: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
  marketCap?: number;
  sector?: string;
  history: Array<{ date: string; price: number; volume?: number }>;
  isFallback?: boolean;
}

const quoteCache = new Map<string, { quote: CachedStock; expires: number }>();
const pendingQuotes = new Map<string, Promise<CachedStock | null>>();

export function stockSymbol(ticker: string): string | null {
  let upper = ticker.trim().toUpperCase();
  // Legacy app identifiers resolved to catalog/provider-confirmed NSE symbols.
  // Never guess across exchanges or the Tata Motors demerger.
  const aliases: Record<string, string> = {
    LTIM: 'LTM', AVENUESAI: 'CCAVENUE', IGI: 'IGIL', DLINK: 'DLINKINDIA',
    ATHER: 'ATHERENERG', DEEPAKBUILD: 'DBEIL', ADITYAINFO: 'CPPLUS',
    GNGELEC: 'EBGNG', ENVIROINFRA: 'EIEL', JUPITERWAG: 'JWL',
  };
  if (!upper.endsWith('.BO')) {
    const bare = upper.replace(/\.NS$/, '');
    if (Object.hasOwn(aliases, bare)) upper = `${aliases[bare]}.NS`;
  }
  if (!/^[A-Z0-9&._-]{1,35}$/.test(upper)) return null;
  return /\.(NS|BO)$/.test(upper) ? upper : `${upper}.NS`;
}

export async function fetchStockQuote(ticker: string): Promise<CachedStock | null> {
  const symbol = stockSymbol(ticker);
  if (!symbol) return null;
  const cached = quoteCache.get(symbol);
  const now = Date.now();

  // If cache is fresh (<90s), return immediately
  if (cached && cached.expires > now) {
    return { ...cached.quote, quoteStatus: quoteStatus(cached.quote as QuoteProvenance) };
  }

  // Await expired quotes so a refresh cannot return yesterday's cached price.
  // Concurrent callers share the same provider request.
  const pending = pendingQuotes.get(symbol);
  if (pending) return pending;
  const request = refreshStockQuote(symbol);
  pendingQuotes.set(symbol, request);
  try {
    return await request;
  } finally {
    pendingQuotes.delete(symbol);
  }
}

async function refreshStockQuote(symbol: string): Promise<CachedStock | null> {
  try {
    const chart = await fetchProviderChart(symbol);
    const observed = normalizeChart(symbol, chart);
    if (!observed) {
      quoteCache.delete(symbol);
      return null;
    }
    const key = symbol.endsWith('.NS') ? symbol.slice(0, -3) : symbol;
    const quote: CachedStock = {
      ...observed,
      ticker: key,
      name: chart.meta.longName || chart.meta.shortName || TICKER_NAMES[key] || key,
      sector: STOCK_METADATA[key]?.sector,
    };
    quoteCache.set(symbol, { quote, expires: Date.now() + 90_000 });
    return quote;
  } catch {
    quoteCache.delete(symbol);
    return null;
  }
}

export async function fetchStocksData(customTickers: string[] = [], forceRealApi = true): Promise<CachedStock[]> {
  const tickers = [...new Set([...Object.keys(TICKER_NAMES), ...customTickers].map(stockSymbol).filter((symbol): symbol is string => symbol !== null))];
  if (!forceRealApi) {
    return [];
  }
  
  // Fast parallel resolution
  const results = await fetchStockQuotes(tickers);
  return results.filter((quote): quote is CachedStock => quote !== null);
}

// Bound provider concurrency for full-universe requests and share each symbol's cache.
export async function fetchStockQuotes(tickers: string[]): Promise<Array<CachedStock | null>> {
  const result: Array<CachedStock | null> = new Array(tickers.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(8, tickers.length) }, async () => {
    while (cursor < tickers.length) {
      const index = cursor++;
      result[index] = await fetchStockQuote(tickers[index]);
    }
  }));
  return result;
}
