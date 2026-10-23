import { indiaDay } from './market-quote';
import type { CachedStock } from './stock-fetcher';
import type { SmallCapStock } from './small-cap-types';

const REQUIRED_HISTORY_SESSIONS = 20;

/** Shared by the scanner and detail view; the quote day never contributes to the baseline. */
export function historicalVolumeCoverage(quote: Pick<CachedStock, 'history' | 'quoteAsOf'>): Pick<SmallCapStock, 'averageVolume' | 'historyCoverage'> {
  const observed = Date.parse(quote.quoteAsOf || '');
  const sessions = new Map<string, number>();
  if (Number.isFinite(observed)) {
    const quoteDay = indiaDay(new Date(observed));
    for (const bar of quote.history || []) {
      const date = Date.parse(bar.date);
      if (!Number.isFinite(date) || date >= observed || typeof bar.volume !== 'number' ||
          !Number.isFinite(bar.volume) || bar.volume < 0 || !Number.isFinite(bar.price) || bar.price <= 0) continue;
      const day = indiaDay(new Date(date));
      if (day < quoteDay) sessions.set(day, bar.volume);
    }
  }
  const previousVolumes = [...sessions.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-REQUIRED_HISTORY_SESSIONS).map(([, volume]) => volume);
  const sufficient = previousVolumes.length === REQUIRED_HISTORY_SESSIONS;
  return {
    averageVolume: sufficient ? previousVolumes.reduce((sum, volume) => sum + volume, 0) / REQUIRED_HISTORY_SESSIONS : undefined,
    historyCoverage: { completedSessions: sessions.size, requiredSessions: REQUIRED_HISTORY_SESSIONS, sufficient },
  };
}
