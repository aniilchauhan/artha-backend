/**
 * AX-04: Market Observation Contract & Normalization Adapters
 *
 * Enforces standardized instrument identity, timestamp provenance,
 * OHLC integrity, session calendar awareness, and corporate-action detection.
 *
 * Strict Invariant: Bad/stale data is rejected with an explicit reason.
 * Same-day unfinished candles cannot enter completed-session baselines.
 */

export interface MarketObservation {
  instrumentId: string; // e.g. "NSE:TRENT"
  providerSymbol: string; // e.g. "TRENT.NS"
  exchange: 'NSE' | 'BSE';
  series: string; // 'EQ', 'BE', 'BZ', 'SM', etc.
  currency: 'INR';
  timezone: 'Asia/Kolkata';
  observationTime: string; // ISO 8601 string
  retrievedAt: string; // ISO 8601 string
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
  isCompletedSession: boolean;
  adjustmentBasis: 'unadjusted' | 'split_adjusted';
  qualityStatus: 'valid' | 'stale' | 'rejected' | 'unavailable';
  rejectionCategory?: ObservationRejectionCategory;
  rejectionReason?: string;
  rawProviderRef?: {
    source: string;
    regularMarketTime: number;
    symbol: string;
  };
}

export type ObservationRejectionCategory =
  | 'INVALID_OHLC'
  | 'FUTURE_TIMESTAMP'
  | 'STALE_QUOTE'
  | 'CIRCUIT_LOCKED'
  | 'SPLIT_DISCONTINUITY'
  | 'MISSING_VOLUME'
  | 'WRONG_SYMBOL'
  | 'UNSUPPORTED_CURRENCY'
  | 'UNFINISHED_CANDLE_FOR_BASELINE';

export interface NormalizationResult {
  success: boolean;
  observation: MarketObservation | null;
  rejectionCategory?: ObservationRejectionCategory;
  rejectionReason?: string;
}

export interface RawCandlePayload {
  symbol?: string;
  ticker?: string;
  currency?: string;
  regularMarketPrice?: number;
  regularMarketTime?: number; // epoch seconds or ms
  quoteAsOf?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  previousClose?: number;
  series?: string;
  dataSource?: string;
  isFallback?: boolean;
}

/** Returns date formatted as YYYY-MM-DD in Asia/Kolkata */
export function getIndiaDateStr(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Returns the current market session status in IST */
export function getIndianMarketSession(now: Date = new Date()) {
  const istString = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  const istDate = new Date(istString);
  const hours = istDate.getHours();
  const minutes = istDate.getMinutes();
  const day = istDate.getDay(); // 0 Sunday, 6 Saturday
  const timeNum = hours * 100 + minutes;

  const isWeekend = day === 0 || day === 6;
  const isPreMarket = !isWeekend && timeNum >= 900 && timeNum < 915;
  const isLiveMarket = !isWeekend && timeNum >= 915 && timeNum <= 1530;
  const isPostMarket = !isWeekend && timeNum > 1530 && timeNum <= 1600;
  const isOffHours = isWeekend || timeNum < 900 || timeNum > 1600;

  return {
    istDateStr: getIndiaDateStr(now),
    timeNum,
    isWeekend,
    isPreMarket,
    isLiveMarket,
    isPostMarket,
    isOffHours,
    sessionLabel: isLiveMarket ? 'LIVE_MARKET' : isPreMarket ? 'PRE_MARKET' : isPostMarket ? 'POST_MARKET' : 'OFF_HOURS',
  };
}

/**
 * Standardizes raw quote/candle payloads into verified MarketObservations.
 * Rejects bad data with explicit diagnostic codes.
 */
export function normalizeObservation(
  raw: RawCandlePayload,
  options: {
    now?: number;
    maxLiveAgeMs?: number;
    requireCompletedCandle?: boolean;
  } = {}
): NormalizationResult {
  const now = options.now ?? Date.now();
  const maxLiveAgeMs = options.maxLiveAgeMs ?? 120_000; // 2 minutes live tolerance
  const requireCompleted = options.requireCompletedCandle ?? false;

  // 1. Symbol & Currency Validation
  const rawSymbol = (raw.symbol || raw.ticker || '').trim().toUpperCase();
  if (!rawSymbol) {
    return {
      success: false,
      observation: null,
      rejectionCategory: 'WRONG_SYMBOL',
      rejectionReason: 'Missing or empty instrument symbol.',
    };
  }

  const currency = (raw.currency || 'INR').toUpperCase();
  if (currency !== 'INR') {
    return {
      success: false,
      observation: null,
      rejectionCategory: 'UNSUPPORTED_CURRENCY',
      rejectionReason: `Currency '${currency}' is not supported. Only 'INR' cash equities are permitted.`,
    };
  }

  // Determine exchange from suffix
  const isBSE = rawSymbol.endsWith('.BO');
  const exchange = isBSE ? 'BSE' : 'NSE';
  const cleanTicker = rawSymbol.replace(/\.(NS|BO)$/, '');
  const providerSymbol = `${cleanTicker}.${isBSE ? 'BO' : 'NS'}`;
  const instrumentId = `${exchange}:${cleanTicker}`;
  const series = raw.series || 'EQ';

  // 2. Timestamp Validation
  let observationTimeMs = 0;
  if (typeof raw.regularMarketTime === 'number' && raw.regularMarketTime > 0) {
    observationTimeMs = raw.regularMarketTime > 1e11 ? raw.regularMarketTime : raw.regularMarketTime * 1000;
  } else if (raw.quoteAsOf) {
    observationTimeMs = Date.parse(raw.quoteAsOf);
  }

  if (!Number.isFinite(observationTimeMs) || observationTimeMs <= 0) {
    return {
      success: false,
      observation: null,
      rejectionCategory: 'STALE_QUOTE',
      rejectionReason: 'Invalid or missing quote observation timestamp.',
    };
  }

  // Reject future timestamps (> 30s drift)
  if (observationTimeMs > now + 30_000) {
    return {
      success: false,
      observation: null,
      rejectionCategory: 'FUTURE_TIMESTAMP',
      rejectionReason: `Observation timestamp ${new Date(observationTimeMs).toISOString()} is in the future.`,
    };
  }

  // 3. Price & OHLC Integrity Checks
  const price = raw.regularMarketPrice ?? raw.close ?? 0;
  const open = raw.open ?? price;
  const high = raw.high ?? price;
  const low = raw.low ?? price;
  const close = raw.close ?? price;
  const volume = raw.volume ?? 0;

  if (price <= 0 || open <= 0 || high <= 0 || low <= 0 || close <= 0) {
    return {
      success: false,
      observation: null,
      rejectionCategory: 'INVALID_OHLC',
      rejectionReason: `Prices must be positive non-zero numbers (observed price: ${price}, open: ${open}, high: ${high}, low: ${low}, close: ${close}).`,
    };
  }

  // High must be >= max(Open, Close, Low)
  if (high < Math.max(open, close, low)) {
    return {
      success: false,
      observation: null,
      rejectionCategory: 'INVALID_OHLC',
      rejectionReason: `High (${high}) cannot be lower than Open (${open}), Close (${close}), or Low (${low}).`,
    };
  }

  // Low must be <= min(Open, Close, High)
  if (low > Math.min(open, close, high)) {
    return {
      success: false,
      observation: null,
      rejectionCategory: 'INVALID_OHLC',
      rejectionReason: `Low (${low}) cannot be higher than Open (${open}), Close (${close}), or High (${high}).`,
    };
  }

  // Volume verification
  if (!Number.isFinite(volume) || volume < 0) {
    return {
      success: false,
      observation: null,
      rejectionCategory: 'MISSING_VOLUME',
      rejectionReason: `Volume must be a non-negative finite number (observed: ${volume}).`,
    };
  }

  // 4. Circuit Lock Filter
  // If High === Low on a completed session or current session, trade is frozen
  if (high === low && volume > 0) {
    return {
      success: false,
      observation: null,
      rejectionCategory: 'CIRCUIT_LOCKED',
      rejectionReason: `Stock is locked in a price circuit band (High ₹${high} === Low ₹${low}). Orders cannot fill reliably.`,
    };
  }

  // 5. Corporate Action & Split Discontinuity Check
  if (raw.previousClose && raw.previousClose > 0) {
    const dropFactor = raw.previousClose / open;
    if (dropFactor >= 1.7) {
      return {
        success: false,
        observation: null,
        rejectionCategory: 'SPLIT_DISCONTINUITY',
        rejectionReason: `Severe overnight price drop detected (prior close ₹${raw.previousClose} -> open ₹${open}, factor ${dropFactor.toFixed(2)}x). Consistent with stock split; unadjusted prices cannot enter model without corporate action adjustment.`,
      };
    }
  }

  // 6. Session Completion & Freshness Status
  const session = getIndianMarketSession(new Date(now));
  const obsDay = getIndiaDateStr(new Date(observationTimeMs));
  const currentDay = session.istDateStr;

  // An observation from today during live hours is unfinished
  const isToday = obsDay === currentDay;
  const isCompletedSession = !isToday || session.isPostMarket || session.isOffHours;

  if (requireCompleted && !isCompletedSession) {
    return {
      success: false,
      observation: null,
      rejectionCategory: 'UNFINISHED_CANDLE_FOR_BASELINE',
      rejectionReason: 'Unfinished session candle cannot enter completed-candle baseline (R20). Wait for 15:30 IST session close.',
    };
  }

  let qualityStatus: MarketObservation['qualityStatus'] = 'valid';
  if (session.isLiveMarket) {
    if (now - observationTimeMs > maxLiveAgeMs) {
      qualityStatus = 'stale';
    }
  }

  const observation: MarketObservation = {
    instrumentId,
    providerSymbol,
    exchange,
    series,
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    observationTime: new Date(observationTimeMs).toISOString(),
    retrievedAt: new Date(now).toISOString(),
    price: Number(price.toFixed(2)),
    open: Number(open.toFixed(2)),
    high: Number(high.toFixed(2)),
    low: Number(low.toFixed(2)),
    close: Number(close.toFixed(2)),
    volume: Math.round(volume),
    turnover: Number(((close * volume) / 10_000_000).toFixed(4)), // ₹ Crore
    isCompletedSession,
    adjustmentBasis: 'unadjusted',
    qualityStatus,
    rawProviderRef: {
      source: raw.dataSource || 'Yahoo Finance',
      regularMarketTime: observationTimeMs,
      symbol: rawSymbol,
    },
  };

  return {
    success: true,
    observation,
  };
}
