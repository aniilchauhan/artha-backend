/**
 * Shared Indian Market (NSE/BSE) Hours & Session Guard Utility
 * Pure TypeScript functions with zero node:* dependencies for universal client & server use.
 */

export interface MarketSessionInfo {
  isOpen: boolean;
  isWeekend: boolean;
  isPreMarket: boolean;
  isPostMarket: boolean;
  isOffHours: boolean;
  sessionStatus: 'NSE_LIVE' | 'PRE_MARKET' | 'WEEKEND' | 'MARKET_CLOSED';
  statusLabel: string;
  statusBadgeColor: 'emerald' | 'amber' | 'slate';
  nextSessionText: string;
}

/**
 * Checks whether the specified timestamp falls within NSE equity market hours:
 * Monday through Friday: 09:15 to 15:30 IST (Indian Standard Time, UTC + 05:30).
 */
export function isNSEMarketOpen(timestamp = Date.now()): boolean {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(timestamp + istOffsetMs);
  const day = istDate.getUTCDay(); // 0 is Sunday, 6 is Saturday
  if (day === 0 || day === 6) return false;

  const hours = istDate.getUTCHours();
  const minutes = istDate.getUTCMinutes();
  const totalMinutes = hours * 60 + minutes;

  // 09:15 IST = 555 minutes, 15:30 IST = 930 minutes
  return totalMinutes >= 555 && totalMinutes <= 930;
}

/**
 * Checks whether the specified timestamp is a weekend (Saturday or Sunday in IST).
 */
export function isWeekendInIST(timestamp = Date.now()): boolean {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(timestamp + istOffsetMs);
  const day = istDate.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Comprehensive Indian Market Session Information
 */
export function getMarketSessionInfo(timestamp = Date.now()): MarketSessionInfo {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(timestamp + istOffsetMs);
  const day = istDate.getUTCDay(); // 0 is Sunday, 6 is Saturday
  const hours = istDate.getUTCHours();
  const minutes = istDate.getUTCMinutes();
  const totalMinutes = hours * 60 + minutes;

  const isWeekend = day === 0 || day === 6;
  const isPreMarket = !isWeekend && totalMinutes >= 540 && totalMinutes < 555; // 09:00 - 09:15
  const isOpen = !isWeekend && totalMinutes >= 555 && totalMinutes <= 930; // 09:15 - 15:30
  const isPostMarket = !isWeekend && totalMinutes > 930 && totalMinutes <= 960; // 15:30 - 16:00
  const isOffHours = isWeekend || totalMinutes < 540 || totalMinutes > 960;

  if (isOpen) {
    return {
      isOpen: true,
      isWeekend: false,
      isPreMarket: false,
      isPostMarket: false,
      isOffHours: false,
      sessionStatus: 'NSE_LIVE',
      statusLabel: 'NSE/BSE LIVE',
      statusBadgeColor: 'emerald',
      nextSessionText: 'Market Open · Closes 3:30 PM IST',
    };
  }

  if (isPreMarket) {
    return {
      isOpen: false,
      isWeekend: false,
      isPreMarket: true,
      isPostMarket: false,
      isOffHours: false,
      sessionStatus: 'PRE_MARKET',
      statusLabel: 'PRE-MARKET',
      statusBadgeColor: 'amber',
      nextSessionText: 'Pre-Market Orders Active · Live at 9:15 AM IST',
    };
  }

  if (isWeekend) {
    return {
      isOpen: false,
      isWeekend: true,
      isPreMarket: false,
      isPostMarket: false,
      isOffHours: true,
      sessionStatus: 'WEEKEND',
      statusLabel: 'WEEKEND CLOSED',
      statusBadgeColor: 'slate',
      nextSessionText: 'Markets Closed for Weekend · Reopens Monday 9:15 AM IST',
    };
  }

  return {
    isOpen: false,
    isWeekend: false,
    isPreMarket: false,
    isPostMarket,
    isOffHours: true,
    sessionStatus: 'MARKET_CLOSED',
    statusLabel: 'MARKET CLOSED',
    statusBadgeColor: 'slate',
    nextSessionText: isPostMarket ? 'Post-Market Settlement · Reopens Tomorrow 9:15 AM IST' : 'Reopens Tomorrow 9:15 AM IST',
  };
}
