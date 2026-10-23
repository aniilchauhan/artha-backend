/**
 * Event Catalyst & Earnings Risk Engine for Stock Predictions
 *
 * Applies event and news score adjustments only to caller-supplied observations.
 * No bundled ticker calendar, earnings surprise table, or news sentiment is treated as current evidence.
 */

export interface UpcomingEarningsEvent {
  ticker: string;
  companyName?: string;
  resultDate: string; // YYYY-MM-DD
  quarter?: string;
  daysUntil: number;
  announced?: string;
}

export interface RecentEarningsSurprise {
  ticker: string;
  quarter?: string;
  resultDate?: string;
  beat: 'beat' | 'miss' | 'inline';
  netProfitYoY?: number;
  revenueYoY?: number;
  commentary?: string;
}

export interface EventCatalystEvaluation {
  ticker: string;
  daysToEarnings?: number;
  earningsDate?: string;
  isUpcomingEarnings: boolean;
  isEarningsBinaryRisk: boolean; // Within 3 days of results
  earningsSurprise?: 'beat' | 'miss' | 'inline';
  earningsCommentary?: string;
  newsSentiment?: 'Bullish' | 'Bearish' | 'Neutral';
  scoreAdjustment: number; // Combined point delta (-30 to +20)
  signals: string[];
  narrativeFragments: string[];
}

function normalizeTicker(ticker: string): string {
  return ticker.replace(/\.(NS|BO)$/i, '').trim().toUpperCase();
}

/**
 * No verified earnings calendar is connected; ticker-only lookups remain unavailable.
 */
export function getUpcomingEarnings(_ticker: string): UpcomingEarningsEvent | null {
  return null;
}

/**
 * No verified earnings-results feed is connected; ticker-only lookups remain unavailable.
 */
export function getRecentEarningsSurprise(_ticker: string): RecentEarningsSurprise | null {
  return null;
}

/**
 * No verified ticker news-sentiment feed is connected; ticker-only lookups remain unavailable.
 */
export function getNewsSentimentCatalyst(_ticker: string): { sentiment: 'Bullish' | 'Bearish' | 'Neutral'; score: number } | null {
  return null;
}

/**
 * Evaluates the full event and news catalyst matrix for any given stock.
 */
export function evaluateStockEventCatalyst(
  ticker: string,
  overrides?: {
    daysToEarnings?: number;
    earningsBeat?: 'beat' | 'miss' | 'inline';
    newsSentiment?: 'Bullish' | 'Bearish' | 'Neutral';
  }
): EventCatalystEvaluation {
  const symbol = normalizeTicker(ticker);
  const upcoming = getUpcomingEarnings(symbol);
  const surprise = getRecentEarningsSurprise(symbol);
  const sentiment = getNewsSentimentCatalyst(symbol);

  const daysToEarnings = overrides?.daysToEarnings ?? upcoming?.daysUntil;
  const earningsDate = upcoming?.resultDate;
  const isUpcomingEarnings = daysToEarnings !== undefined && daysToEarnings >= 0;
  // Binary risk exists if results are within 3 trading days
  const isEarningsBinaryRisk = daysToEarnings !== undefined && daysToEarnings >= 0 && daysToEarnings <= 3;

  const earningsSurprise = overrides?.earningsBeat ?? surprise?.beat;
  const newsSentiment = overrides?.newsSentiment ?? sentiment?.sentiment;

  let scoreAdjustment = 0;
  const signals: string[] = [];
  const narrativeFragments: string[] = [];

  // 1. Upcoming earnings binary risk guard (-15 pts, signal flag)
  if (isEarningsBinaryRisk) {
    scoreAdjustment -= 15;
    signals.push('upcoming earnings risk');
    narrativeFragments.push(`event risk: quarterly results are due in ${daysToEarnings} day${daysToEarnings === 1 ? '' : 's'}`);
  } else if (isUpcomingEarnings && daysToEarnings <= 7) {
    narrativeFragments.push(`earnings notice: results scheduled in ${daysToEarnings} days`);
  }

  // 2. Post-Earnings Announcement Drift (PEAD Catalyst):
  if (earningsSurprise === 'beat') {
    scoreAdjustment += 10;
    signals.push('earnings beat catalyst');
    narrativeFragments.push('catalyst: recent quarterly results beat market estimates');
  } else if (earningsSurprise === 'miss') {
    scoreAdjustment -= 15;
    signals.push('earnings miss overhang');
    narrativeFragments.push('headwind: recent quarterly results missed market estimates');
  }

  // 3. News sentiment overlay (-10 to +5 pts)
  if (newsSentiment === 'Bullish') {
    scoreAdjustment += 5;
    signals.push('bullish news sentiment');
    narrativeFragments.push('catalyst: positive financial news sentiment');
  } else if (newsSentiment === 'Bearish') {
    scoreAdjustment -= 10;
    signals.push('bearish news overhang');
    narrativeFragments.push('headwind: adverse financial news sentiment');
  }

  return {
    ticker: symbol,
    daysToEarnings,
    earningsDate,
    isUpcomingEarnings,
    isEarningsBinaryRisk,
    earningsSurprise,
    earningsCommentary: surprise?.commentary,
    newsSentiment,
    scoreAdjustment,
    signals,
    narrativeFragments,
  };
}
