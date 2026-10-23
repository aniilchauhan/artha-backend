const ALLOWED_PROFILE_FIELDS = new Set([
  'watchlist', 'customTickers', 'holdings', 'thresholds',
  'portfolioTransactions', 'portfolioCash', 'portfolioEquityHistory', 'portfolioRiskRules',
  'savedFilters', 'watchlistGroups',
]);
const TICKER_REGEX = /^[A-Za-z0-9._-]{1,25}$/;
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isTickerKey(ticker: string): boolean {
  return isValidTicker(ticker) && !ticker.includes('.') && !RESERVED_KEYS.has(ticker);
}

// Retain support for numeric strings without treating null, booleans or arrays as money.
function profileNumber(value: unknown): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return NaN;
  return Number(value);
}

/**
 * Validates ticker symbol string.
 */
function isValidTicker(ticker: unknown): ticker is string {
  return typeof ticker === 'string' && ticker.length > 0 && ticker.length <= 25 && TICKER_REGEX.test(ticker);
}

/**
 * Validates and sanitizes profile update payload.
 */
export function validateProfileUpdates(body: any): { valid: boolean; error?: string; cleanUpdates?: any } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Request body must be a valid JSON object.' };
  }

  const keys = Object.keys(body);
  if (keys.length === 0) {
    return { valid: false, error: 'No update fields provided.' };
  }

  // Reject unsupported fields (e.g. password, email, _id)
  for (const key of keys) {
    if (!ALLOWED_PROFILE_FIELDS.has(key)) {
      return {
        valid: false,
        error: `Field "${key}" is not editable via profile API. Credential and system fields cannot be modified here.`,
      };
    }
  }

  const cleanUpdates: any = {};

  // 1. Validate watchlist
  if ('watchlist' in body) {
    if (!Array.isArray(body.watchlist)) {
      return { valid: false, error: 'Watchlist must be an array of tickers.' };
    }
    if (body.watchlist.length > 150) {
      return { valid: false, error: 'Watchlist cannot exceed 150 tickers.' };
    }
    for (const t of body.watchlist) {
      if (!isValidTicker(t)) {
        return { valid: false, error: `Invalid ticker format in watchlist: "${String(t)}".` };
      }
    }
    if (new Set(body.watchlist.map((ticker: string) => ticker.toUpperCase())).size !== body.watchlist.length) {
      return { valid: false, error: 'Watchlist cannot contain duplicate tickers.' };
    }
    cleanUpdates.watchlist = body.watchlist;
  }

  // 2. Validate customTickers
  if ('customTickers' in body) {
    if (!Array.isArray(body.customTickers)) {
      return { valid: false, error: 'Custom tickers must be an array.' };
    }
    if (body.customTickers.length > 50) {
      return { valid: false, error: 'Custom tickers cannot exceed 50 items.' };
    }
    for (const t of body.customTickers) {
      if (!isValidTicker(t)) {
        return { valid: false, error: `Invalid ticker format in custom tickers: "${String(t)}".` };
      }
    }
    if (new Set(body.customTickers.map((ticker: string) => ticker.toUpperCase())).size !== body.customTickers.length) {
      return { valid: false, error: 'Custom tickers cannot contain duplicate tickers.' };
    }
    cleanUpdates.customTickers = body.customTickers;
  }

  // 3. Validate holdings
  if ('holdings' in body) {
    if (!body.holdings || typeof body.holdings !== 'object' || Array.isArray(body.holdings)) {
      return { valid: false, error: 'Holdings must be a key-value object of positions.' };
    }
    const holdingKeys = Object.keys(body.holdings);
    if (holdingKeys.length > 100) {
      return { valid: false, error: 'Holdings cannot exceed 100 positions.' };
    }

    const cleanHoldings: Record<string, any> = {};
    for (const ticker of holdingKeys) {
      if (!isTickerKey(ticker)) {
        return { valid: false, error: `Invalid ticker key in holdings: "${ticker}".` };
      }

      const h = body.holdings[ticker];
      if (!h || typeof h !== 'object' || Array.isArray(h)) {
        return { valid: false, error: `Holding data for "${ticker}" must be an object.` };
      }

      const qty = profileNumber(h.quantity);
      const buyPrice = profileNumber(h.buyPrice);

      if (!Number.isFinite(qty) || qty < 0 || qty > 10000000) {
        return { valid: false, error: `Holding quantity for "${ticker}" must be a positive number up to 10,000,000.` };
      }
      if (!Number.isFinite(buyPrice) || buyPrice < 0 || buyPrice > 100000000) {
        return { valid: false, error: `Holding buy price for "${ticker}" must be a positive number.` };
      }

      cleanHoldings[ticker] = {
        ticker,
        quantity: qty,
        buyPrice,
      };
    }
    cleanUpdates.holdings = cleanHoldings;
  }

  // 4. Validate thresholds
  if ('thresholds' in body) {
    if (!body.thresholds || typeof body.thresholds !== 'object' || Array.isArray(body.thresholds)) {
      return { valid: false, error: 'Thresholds must be an object mapping ticker to price.' };
    }
    const thresholdKeys = Object.keys(body.thresholds);
    if (thresholdKeys.length > 100) {
      return { valid: false, error: 'Thresholds cannot exceed 100 items.' };
    }

    const cleanThresholds: Record<string, number> = {};
    for (const ticker of thresholdKeys) {
      if (!isTickerKey(ticker)) {
        return { valid: false, error: `Invalid ticker key in thresholds: "${ticker}".` };
      }
      const val = profileNumber(body.thresholds[ticker]);
      if (!Number.isFinite(val) || val < 0 || val > 100000000) {
        return { valid: false, error: `Threshold price for "${ticker}" must be a valid positive number.` };
      }
      cleanThresholds[ticker] = val;
    }
    cleanUpdates.thresholds = cleanThresholds;
  }

  if ('portfolioTransactions' in body) {
    if (!Array.isArray(body.portfolioTransactions) || body.portfolioTransactions.length > 5000) {
      return { valid: false, error: 'Portfolio transactions must be an array with at most 5,000 entries.' };
    }
    const transactions: Record<string, unknown>[] = [];
    const ids = new Set<string>();
    for (const row of body.portfolioTransactions) {
      if (!row || typeof row !== 'object' || Array.isArray(row)
        || typeof row.ticker !== 'string' || !isTickerKey(row.ticker)
        || !['BUY', 'SELL'].includes(row.action)
        || !Number.isFinite(row.quantity) || row.quantity <= 0 || row.quantity > 1e7
        || !Number.isFinite(row.price) || row.price <= 0 || row.price > 1e8) {
        return { valid: false, error: 'Portfolio transactions contain an invalid trade.' };
      }
      const cleanRow: Record<string, unknown> = {
        ticker: row.ticker, action: row.action, quantity: row.quantity, price: row.price,
      };
      for (const field of ['id', 'timestamp', 'displayName', 'isin', 'matchSource', 'emotionalTag', 'importBatchId']) {
        if (field in row) {
          if (typeof row[field] !== 'string' || (field === 'id' && !row[field].trim()) || row[field].length > 500) {
            return { valid: false, error: `Invalid transaction ${field}.` };
          }
          cleanRow[field] = row[field];
        }
      }
      for (const field of ['brokerage', 'taxes', 'netValue', 'reportedPnl', 'holdingDays']) {
        if (field in row) {
          if (!Number.isFinite(row[field]) || Math.abs(row[field]) > 1e15
            || (['brokerage', 'taxes', 'holdingDays'].includes(field) && row[field] < 0)) {
            return { valid: false, error: `Invalid transaction ${field}.` };
          }
          cleanRow[field] = row[field];
        }
      }
      if (row.id && ids.has(row.id)) {
        return { valid: false, error: 'Portfolio transactions contain duplicate IDs.' };
      }
      if (row.id) ids.add(row.id);
      transactions.push(cleanRow);
    }
    cleanUpdates.portfolioTransactions = transactions;
  }

  if ('portfolioCash' in body) {
    const cash = profileNumber(body.portfolioCash);
    if (!Number.isFinite(cash) || cash < 0 || cash > 1e15) {
      return { valid: false, error: 'Portfolio cash must be a finite non-negative amount.' };
    }
    cleanUpdates.portfolioCash = cash;
  }

  if ('portfolioEquityHistory' in body) {
    if (!Array.isArray(body.portfolioEquityHistory) || body.portfolioEquityHistory.length > 5000) {
      return { valid: false, error: 'Portfolio equity history must be an array with at most 5,000 entries.' };
    }
    const history: { time: string; value: number }[] = [];
    for (const point of body.portfolioEquityHistory) {
      if (!point || typeof point !== 'object' || Array.isArray(point)
        || typeof point.time !== 'string' || !point.time.trim() || point.time.length > 100
        || !Number.isFinite(point.value) || point.value < 0 || point.value > 1e15) {
        return { valid: false, error: 'Portfolio equity history contains an invalid point.' };
      }
      history.push({ time: point.time, value: point.value });
    }
    cleanUpdates.portfolioEquityHistory = history;
  }

  if ('portfolioRiskRules' in body) {
    if (!body.portfolioRiskRules || typeof body.portfolioRiskRules !== 'object' || Array.isArray(body.portfolioRiskRules)) {
      return { valid: false, error: 'Portfolio risk rules must be an object.' };
    }
    if (Object.keys(body.portfolioRiskRules).length > 100) {
      return { valid: false, error: 'Portfolio risk rules cannot exceed 100 positions.' };
    }
    const rules: Record<string, { stopLoss: number | null; takeProfit: number | null; autoExit: boolean }> = {};
    for (const [ticker, value] of Object.entries(body.portfolioRiskRules)) {
      if (!isTickerKey(ticker)) {
        return { valid: false, error: `Invalid ticker key in portfolio risk rules: "${ticker}".` };
      }
      const rule = value as Record<string, unknown> | null;
      if (!rule || typeof rule !== 'object' || Array.isArray(rule) || typeof rule.autoExit !== 'boolean') {
        return { valid: false, error: `Invalid portfolio risk rule for "${ticker}".` };
      }
      for (const field of ['stopLoss', 'takeProfit']) {
        const price = rule[field];
        if (price !== null && (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 1e8)) {
          return { valid: false, error: `Invalid ${field} for "${ticker}".` };
        }
      }
      rules[ticker] = { stopLoss: rule.stopLoss as number | null, takeProfit: rule.takeProfit as number | null, autoExit: rule.autoExit };
    }
    cleanUpdates.portfolioRiskRules = rules;
  }

  // 8. Validate savedFilters
  if ('savedFilters' in body) {
    if (!Array.isArray(body.savedFilters)) {
      return { valid: false, error: 'Saved filters must be an array.' };
    }
    if (body.savedFilters.length > 25) {
      return { valid: false, error: 'Saved filters cannot exceed 25 presets.' };
    }
    const cleanFilters: any[] = [];
    const filterIds = new Set<string>();
    for (const item of body.savedFilters) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return { valid: false, error: 'Saved filter must be an object.' };
      }
      if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(item.id)) {
        return { valid: false, error: 'Saved filter id must be 1-64 alphanumeric characters.' };
      }
      if (filterIds.has(item.id)) {
        return { valid: false, error: 'Saved filters cannot contain duplicate IDs.' };
      }
      filterIds.add(item.id);
      if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 50) {
        return { valid: false, error: 'Saved filter name must be 1-50 characters.' };
      }
      const cleanItem: any = {
        id: item.id,
        name: item.name.trim(),
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      };
      if (item.filters && typeof item.filters === 'object' && !Array.isArray(item.filters)) {
        cleanItem.filters = {};
        for (const [k, v] of Object.entries(item.filters)) {
          if (RESERVED_KEYS.has(k)) continue;
          if (typeof v === 'number' && Number.isFinite(v)) {
            cleanItem.filters[k] = v;
          } else if (typeof v === 'string' && v.length <= 50) {
            cleanItem.filters[k] = v;
          }
        }
      } else {
        cleanItem.filters = {};
      }
      cleanFilters.push(cleanItem);
    }
    cleanUpdates.savedFilters = cleanFilters;
  }

  // 9. Validate watchlistGroups
  if ('watchlistGroups' in body) {
    if (!Array.isArray(body.watchlistGroups)) {
      return { valid: false, error: 'Watchlist groups must be an array.' };
    }
    if (body.watchlistGroups.length > 20) {
      return { valid: false, error: 'Watchlist groups cannot exceed 20 groups.' };
    }
    const cleanGroups: any[] = [];
    const groupIds = new Set<string>();
    for (const group of body.watchlistGroups) {
      if (!group || typeof group !== 'object' || Array.isArray(group)) {
        return { valid: false, error: 'Watchlist group must be an object.' };
      }
      if (typeof group.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(group.id)) {
        return { valid: false, error: 'Watchlist group id must be 1-64 alphanumeric characters.' };
      }
      if (groupIds.has(group.id)) {
        return { valid: false, error: 'Watchlist groups cannot contain duplicate IDs.' };
      }
      groupIds.add(group.id);
      if (typeof group.name !== 'string' || !group.name.trim() || group.name.length > 50) {
        return { valid: false, error: 'Watchlist group name must be 1-50 characters.' };
      }
      if (!Array.isArray(group.tickers)) {
        return { valid: false, error: 'Watchlist group tickers must be an array.' };
      }
      if (group.tickers.length > 100) {
        return { valid: false, error: 'Watchlist group tickers cannot exceed 100 symbols.' };
      }
      const tickers: string[] = [];
      const seen = new Set<string>();
      for (const t of group.tickers) {
        if (!isValidTicker(t)) {
          return { valid: false, error: `Invalid ticker format in watchlist group: "${String(t)}".` };
        }
        const upper = t.toUpperCase();
        if (!seen.has(upper)) {
          seen.add(upper);
          tickers.push(t);
        }
      }
      const cleanGroup: any = {
        id: group.id,
        name: group.name.trim(),
        tickers,
      };
      if (typeof group.color === 'string' && group.color.length <= 20) {
        cleanGroup.color = group.color;
      }
      cleanGroups.push(cleanGroup);
    }
    cleanUpdates.watchlistGroups = cleanGroups;
  }

  return { valid: true, cleanUpdates };
}
