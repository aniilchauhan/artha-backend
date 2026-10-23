/**
 * Indian & International Trade Date Parser and Financial Year Utilities
 *
 * Correctly parses DD-MM-YYYY (e.g. 11-09-2026), DD/MM/YYYY, DD-MMM-YYYY, ISO, and Excel dates.
 * Standardizes all dates to ISO string YYYY-MM-DD.
 */

const MONTH_NAMES: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
  JANUARY: 0, FEBRUARY: 1, MARCH: 2, APRIL: 3,
  JUNE: 5, JULY: 6, AUGUST: 7, SEPTEMBER: 8,
  OCTOBER: 9, NOVEMBER: 10, DECEMBER: 11,
};

export interface ParsedDateInfo {
  date: Date;
  isoDate: string; // YYYY-MM-DD
  displayDate: string; // DD-MMM-YYYY
  timestamp: string; // ISO string or original
}

/**
 * Robust date parser for broker exports.
 * Supports:
 * - DD-MM-YYYY or DD/MM/YYYY (e.g. 11-09-2026 -> 11 Sep 2026)
 * - DD-MMM-YYYY (e.g. 11-SEP-2026, 02-Jan-2026)
 * - YYYY-MM-DD (ISO)
 * - Excel serial number dates (e.g. 45000)
 * - Timestamps (e.g. 11-09-2026 10:30:00)
 */
export function parseTradeDate(value: unknown): ParsedDateInfo | null {
  if (value === null || value === undefined || value === '') return null;

  // If already a valid Date object
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return formatParsedDate(value);
  }

  // Excel serial number (numeric date for modern trades 2009-2064: 40000 to 60000)
  const numVal = typeof value === 'number' ? value : (typeof value === 'string' && /^\d{5}$/.test(value.trim()) ? Number(value.trim()) : null);
  if (numVal !== null && Number.isFinite(numVal) && numVal >= 40000 && numVal <= 60000) {
    // Excel epoch offset (25569 days between 1900-01-01 and 1970-01-01)
    const ms = Math.round((numVal - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return formatParsedDate(d);
  }

  const str = String(value).trim();
  if (!str) return null;

  // 1. DD-MM-YYYY or DD/MM/YYYY (with optional time, supports 2-digit and 4-digit years)
  // Example: "11-09-2026", "11/09/2026", "11-09-26", "11-09-2026 14:30:00"
  const ddmmyyyyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (ddmmyyyyMatch) {
    const day = parseInt(ddmmyyyyMatch[1], 10);
    const month = parseInt(ddmmyyyyMatch[2], 10) - 1;
    let year = parseInt(ddmmyyyyMatch[3], 10);
    if (year < 100) {
      year += (year >= 70 ? 1900 : 2000);
    }
    const hour = ddmmyyyyMatch[4] ? parseInt(ddmmyyyyMatch[4], 10) : 0;
    const minute = ddmmyyyyMatch[5] ? parseInt(ddmmyyyyMatch[5], 10) : 0;
    const second = ddmmyyyyMatch[6] ? parseInt(ddmmyyyyMatch[6], 10) : 0;

    if (month >= 0 && month < 12 && day >= 1 && day <= 31) {
      const d = new Date(year, month, day, hour, minute, second);
      // Double check validity (e.g. 31 Feb)
      if (d.getFullYear() === year && d.getMonth() === month && d.getDate() === day) {
        return formatParsedDate(d);
      }
    }
  }

  // 2. DD-MMM-YYYY or DD MMM YYYY (e.g. "11-Sep-2026", "02-JAN-26")
  const ddmmmyyyyMatch = str.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s](\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (ddmmmyyyyMatch) {
    const day = parseInt(ddmmmyyyyMatch[1], 10);
    const monthStr = ddmmmyyyyMatch[2].toUpperCase();
    const month = MONTH_NAMES[monthStr];
    let year = parseInt(ddmmmyyyyMatch[3], 10);
    if (year < 100) {
      year += (year >= 70 ? 1900 : 2000);
    }

    if (month !== undefined && day >= 1 && day <= 31) {
      const d = new Date(year, month, day);
      if (d.getFullYear() === year && d.getMonth() === month && d.getDate() === day) {
        return formatParsedDate(d);
      }
    }
  }

  // 3. ISO YYYY-MM-DD (e.g. "2026-09-11", "2026-09-11T10:00:00Z")
  const isoMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    const hour = isoMatch[4] ? parseInt(isoMatch[4], 10) : 0;
    const minute = isoMatch[5] ? parseInt(isoMatch[5], 10) : 0;
    const second = isoMatch[6] ? parseInt(isoMatch[6], 10) : 0;

    if (month >= 0 && month < 12 && day >= 1 && day <= 31) {
      const d = new Date(year, month, day, hour, minute, second);
      if (d.getFullYear() === year && d.getMonth() === month && d.getDate() === day) {
        return formatParsedDate(d);
      }
    }
  }

  // 4. Standard Date fallback parse
  const fallback = new Date(str);
  if (!Number.isNaN(fallback.getTime())) {
    return formatParsedDate(fallback);
  }

  return null;
}

function formatParsedDate(date: Date): ParsedDateInfo {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const isoDate = `${y}-${m}-${d}`;

  const monthShort = date.toLocaleDateString('en-US', { month: 'short' });
  const displayDate = `${d}-${monthShort}-${y}`;

  return {
    date,
    isoDate,
    displayDate,
    timestamp: isoDate,
  };
}

/**
 * Returns Indian Financial Year string for a given date.
 * Financial Year runs from April 1 to March 31.
 * e.g. 15-Jan-2026 -> "2025-26"
 *      15-Sep-2026 -> "2026-27"
 */
export function getFinancialYear(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0 = Jan, 2 = Mar, 3 = Apr
  if (month >= 3) {
    // April to December: FY is year - (year + 1)
    const nextShort = String((year + 1) % 100).padStart(2, '0');
    return `${year}-${nextShort}`;
  } else {
    // January to March: FY is (year - 1) - year
    const currShort = String(year % 100).padStart(2, '0');
    return `${year - 1}-${currShort}`;
  }
}

/**
 * Returns start and end dates for a financial year string like "2025-26".
 */
export function getFinancialYearRange(fy: string): { start: Date; end: Date } | null {
  const match = fy.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const startYear = parseInt(match[1], 10);
  const start = new Date(startYear, 3, 1, 0, 0, 0); // April 1
  const end = new Date(startYear + 1, 2, 31, 23, 59, 59, 999); // March 31
  return { start, end };
}

/**
 * Generates a list of recent Financial Years for the UI selector.
 */
export function getAvailableFinancialYears(count = 4): { id: string; label: string; current: boolean }[] {
  const currentFy = getFinancialYear(new Date());
  const match = currentFy.match(/^(\d{4})/);
  const currentStartYear = match ? parseInt(match[1], 10) : new Date().getFullYear();

  const list = [];
  for (let i = 0; i < count; i++) {
    const y = currentStartYear - i;
    const nextShort = String((y + 1) % 100).padStart(2, '0');
    const fyId = `${y}-${nextShort}`;
    list.push({
      id: fyId,
      label: `FY ${fyId}${i === 0 ? ' (Current)' : ''}`,
      current: i === 0,
    });
  }
  return list;
}
