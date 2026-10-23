import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { alertDirectory, readAlerts, updateAlerts, type AlertState } from './alert-store';
import { fetchStockQuote, type CachedStock } from './stock-fetcher';
import { canUseQuoteForExecution } from './market-quote';
import { getAxionProjectRoot } from './project-root';
import fsSync from 'node:fs';

export { isNSEMarketOpen } from './market-hours';
import { isNSEMarketOpen } from './market-hours';

export interface TriggerEvaluationOptions {
  bypassMarketHours?: boolean;
}

export function recordTriggeredAlerts(
  state: AlertState,
  quotes: Map<string, CachedStock | null>,
  now = Date.now(),
  options: TriggerEvaluationOptions = {}
) {
  const marketOpen = isNSEMarketOpen(now);
  const enforceMarketHours = state.preferences ? (state.preferences.marketHoursOnly ?? false) : false;

  for (const rule of state.rules) {
    const quote = quotes.get(rule.ticker);
    if (!rule.enabled || !quote || !canUseQuoteForExecution(quote, now)) continue;

    // Check market session schedule guarding if marketHoursOnly is active
    if (enforceMarketHours && !options.bypassMarketHours && !marketOpen) {
      continue; // Suppressed outside NSE trading session
    }

    // ── Smart Signal Alerts (squeeze / high_conviction) ────────────────────
    const alertType = rule.alertType ?? 'price';

    if (alertType === 'squeeze' || alertType === 'high_conviction') {
      // Read options snapshot for squeeze signal
      let isSqueezeSetup = false;
      let squeezeNote: string | undefined;
      let convictionScore: number | undefined;

      if (alertType === 'squeeze') {
        try {
          const snapshotFile = path.join(getAxionProjectRoot(), 'stock-ai', 'data', 'options', 'latest_options.json');
          if (fsSync.existsSync(snapshotFile)) {
            const snap = JSON.parse(fsSync.readFileSync(snapshotFile, 'utf-8')) as Record<string, any>;
            const cleanTicker = rule.ticker.replace(/\.(NS|BO)$/i, '').toUpperCase();
            const tickerData = snap[cleanTicker] || snap[`${cleanTicker}.NS`];
            if (tickerData?.isSqueezeSetup) {
              isSqueezeSetup = true;
              squeezeNote = tickerData.squeezeNote ?? `Short-covering squeeze detected on ${rule.ticker}`;
            }
          }
        } catch { /* snapshot unavailable */ }

        if (!isSqueezeSetup) continue; // Signal not active — skip
      }

      if (alertType === 'high_conviction') {
        // Read latest small-cap scan conviction score from snapshot if available
        try {
          const scanFile = path.join(getAxionProjectRoot(), '.axion', 'small-cap-scan-latest.json');
          if (fsSync.existsSync(scanFile)) {
            const scan = JSON.parse(fsSync.readFileSync(scanFile, 'utf-8')) as any;
            const cleanTicker = rule.ticker.replace(/\.(NS|BO)$/i, '').toUpperCase();
            const stock = (scan?.stocks || []).find((s: any) =>
              (s.providerSymbol || s.ticker || '').replace(/\.(NS|BO)$/i, '').toUpperCase() === cleanTicker
            );
            convictionScore = typeof stock?.convictionScore === 'number' ? stock.convictionScore : undefined;
          }
        } catch { /* scan file unavailable */ }

        const minScore = rule.minConvictionScore ?? 70;
        if (typeof convictionScore !== 'number' || convictionScore < minScore) continue;
      }

      // Apply cooldown + daily cap (reuse same logic as price alerts)
      const cooldownMinutes = rule.cooldownMinutes ?? (state.preferences ? state.preferences.cooldownMinutes : 0);
      if (cooldownMinutes > 0 && rule.lastTriggeredAt) {
        const elapsedMs = now - Date.parse(rule.lastTriggeredAt);
        if (elapsedMs < cooldownMinutes * 60 * 1000) continue;
      }
      const todayDate = new Date(now).toISOString().slice(0, 10);
      const maxDaily = rule.maxDailyTriggers ?? (state.preferences ? state.preferences.maxDailyAlertsPerSymbol : undefined);
      if (maxDaily && maxDaily > 0) {
        if (rule.dailyTriggerDate === todayDate && (rule.dailyTriggerCount ?? 0) >= maxDaily) continue;
      }

      rule.lastTriggeredAt = new Date(now).toISOString();
      if (rule.dailyTriggerDate === todayDate) {
        rule.dailyTriggerCount = (rule.dailyTriggerCount ?? 0) + 1;
      } else {
        rule.dailyTriggerDate = todayDate;
        rule.dailyTriggerCount = 1;
      }
      if (!rule.recurring) rule.enabled = false;

      state.events.push({
        id: randomUUID(),
        ruleId: rule.id,
        ticker: rule.ticker,
        threshold: rule.threshold,
        price: quote.currentPrice,
        quoteAsOf: quote.quoteAsOf!,
        triggeredAt: new Date(now).toISOString(),
        read: false,
        direction: rule.direction,
        label: rule.label ?? (alertType === 'squeeze' ? 'Short-Covering Squeeze' : 'High Conviction Setup'),
        alertType,
        ...(convictionScore !== undefined ? { convictionScore } : {}),
        ...(squeezeNote ? { squeezeNote } : {}),
      });
      continue; // Smart alert handled — skip price check below
    }

    // ── Standard Price Alerts ────────────────────────────────────────────

    let isTriggered = false;
    if (rule.direction === 'below') {
      isTriggered = quote.currentPrice <= rule.threshold;
    } else if (rule.direction === 'above') {
      isTriggered = quote.currentPrice >= rule.threshold;
    } else {
      isTriggered = quote.currentPrice > rule.threshold;
    }

    if (!isTriggered) continue;

    // Check cooldown deduplication window
    const cooldownMinutes = rule.cooldownMinutes ?? (state.preferences ? state.preferences.cooldownMinutes : 0);
    if (cooldownMinutes && cooldownMinutes > 0 && rule.lastTriggeredAt) {
      const elapsedMs = now - Date.parse(rule.lastTriggeredAt);
      if (elapsedMs < cooldownMinutes * 60 * 1000) {
        continue; // Deduplicated: suppressed within active cooldown window
      }
    }

    // Check daily trigger frequency cap
    const todayDate = new Date(now).toISOString().slice(0, 10);
    const maxDaily = rule.maxDailyTriggers ?? (state.preferences ? state.preferences.maxDailyAlertsPerSymbol : undefined);
    if (maxDaily && maxDaily > 0) {
      if (rule.dailyTriggerDate === todayDate && (rule.dailyTriggerCount ?? 0) >= maxDaily) {
        continue; // Suppressed: reached daily alert frequency cap
      }
    }

    // Update rule trigger state
    rule.lastTriggeredAt = new Date(now).toISOString();
    if (rule.dailyTriggerDate === todayDate) {
      rule.dailyTriggerCount = (rule.dailyTriggerCount ?? 0) + 1;
    } else {
      rule.dailyTriggerDate = todayDate;
      rule.dailyTriggerCount = 1;
    }

    // Unless rule is explicitly recurring, disable it after triggering
    if (!rule.recurring) {
      rule.enabled = false;
    }

    state.events.push({
      id: randomUUID(),
      ruleId: rule.id,
      ticker: rule.ticker,
      threshold: rule.threshold,
      price: quote.currentPrice,
      quoteAsOf: quote.quoteAsOf!,
      triggeredAt: new Date(now).toISOString(),
      read: false,
      direction: rule.direction,
      label: rule.label,
      alertType: 'price',
    });
  }
}

export async function checkPriceAlerts(now = Date.now(), options: TriggerEvaluationOptions = {}) {
  await fs.mkdir(alertDirectory(), { recursive: true });
  const keys = (await fs.readdir(alertDirectory())).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => name.slice(0, -5));
  const tickerSet = new Set<string>();
  for (const key of keys) for (const rule of (await readAlerts(key)).rules) if (rule.enabled) tickerSet.add(rule.ticker);
  const tickers = [...tickerSet];
  const quotes = new Map<string, CachedStock | null>();
  // Bound simultaneous requests; never invent data for failed providers.
  for (let i = 0; i < tickers.length; i += 4) {
    await Promise.all(tickers.slice(i, i + 4).map(async ticker => {
      try { quotes.set(ticker, await fetchStockQuote(ticker)); }
      catch { quotes.set(ticker, null); }
    }));
  }
  for (const key of keys) await updateAlerts(key, state => recordTriggeredAlerts(state, quotes, now, options));
  const heartbeat = { checkedAt: new Date(now).toISOString(), requestedQuotes: tickers.length,
    usableQuotes: [...quotes.values()].filter(quote => quote && canUseQuoteForExecution(quote, now)).length };
  const temp = path.join(alertDirectory(), `worker-${randomUUID()}.tmp`);
  await fs.writeFile(temp, JSON.stringify(heartbeat));
  await fs.rename(temp, path.join(alertDirectory(), 'worker.json'));
  return heartbeat;
}
