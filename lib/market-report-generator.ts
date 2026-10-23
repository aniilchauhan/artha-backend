import { scanMarketGaps } from './gap-engine';
import type { GapScanSource } from './gap-types';

export interface DailyMarketSessionReport {
  date: string;
  generatedAt: string;
  universeScanned: number;
  universeTotal: number;
  source: GapScanSource;
  gapSummary: {
    totalGaps: number;
    gapUpCount: number;
    gapDownCount: number;
    filledCount: number;
    unfilledCount: number;
    fillRatePercent: number;
    extremeGapsCount: number;
  };
  topGaps: Array<{
    symbol: string;
    gapPercent: number;
    fillPercent: number;
    dayChangeFromOpenPercent: number;
    fillStatus: string;
    setupType: string;
  }>;
  markdownContent: string;
}

export async function generateDailyMarketSessionReport(sessionDate?: string): Promise<DailyMarketSessionReport> {
  const now = new Date().toISOString();

  // 1. Gather Gap Data
  const { summary, items, coverage, source } = await scanMarketGaps();
  if (!source) throw new Error('No provider-backed gap observations are available for a session report.');
  if (sessionDate && sessionDate !== source.sessionDate) {
    throw new Error(`Requested session ${sessionDate} is unavailable; latest provider session is ${source.sessionDate}.`);
  }
  const date = source.sessionDate;

  const topGaps = items.slice(0, 5).map(it => ({
    symbol: it.symbol,
    gapPercent: it.gapPercent,
    fillPercent: it.fillPercent,
    dayChangeFromOpenPercent: it.dayChangeFromOpenPercent,
    fillStatus: it.fillStatus,
    setupType: it.setupType,
  }));

  // 2. Report only observed provider prices and OHLC; no legacy cohort results.
  const md = [
    `# Axion Daily Market Session Briefing`,
    `**Session Date:** ${date} | **Generated At:** ${new Date(now).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`,
    `**Source:** ${source.provider} | Quotes observed from ${source.quoteAsOf} through ${source.latestQuoteAsOf}`,
    `**Coverage:** ${coverage.evaluated}/${coverage.total} tracked symbols had usable OHLC bars.\n`,
    `---`,
    `## 1. Opening Gap Overview & Fill Dynamics`,
    `- **Total Gaps Detected (>= 0.2%):** ${summary.totalGaps} stocks`,
    `- **Gap Up / Gap Down:** 🟢 ${summary.gapUpCount} Up | 🔴 ${summary.gapDownCount} Down`,
    `- **Observed Gap Fill Rate:** **${summary.totalGaps > 0 ? Math.round((summary.filledCount / summary.totalGaps) * 100) : 0}%** (${summary.filledCount}/${summary.totalGaps} gaps touched the previous close by the quote time)`,
    `- **Gaps not yet filled:** ${summary.unfilledCount} stocks`,
    `- **Average Gap Magnitude:** ${summary.avgGapPercent}%`,
    `- **Extended gaps (> 3%):** ${items.filter(i => i.isExtendedGap).length} stocks\n`,
    `### Key Session Gap Leaders`,
    `| Symbol | Gap % | Setup Type | Fill % | Move from open |`,
    `| :--- | :--- | :--- | :--- | :--- |`,
    ...topGaps.map(
      g =>
        `| **${g.symbol}** | ${g.gapPercent >= 0 ? '+' : ''}${g.gapPercent}% | \`${g.setupType}\` | ${g.fillPercent}% (${g.fillStatus}) | ${g.dayChangeFromOpenPercent >= 0 ? '+' : ''}${g.dayChangeFromOpenPercent}% |`
    ),
    `\n---`,
    `This briefing describes observed price movement and gap fills for the provider timestamp above. It is not portfolio performance or a strategy backtest.`,
  ].join('\n');

  return {
    date,
    generatedAt: now,
    universeScanned: summary.totalScanned,
    universeTotal: coverage.total,
    source,
    gapSummary: {
      totalGaps: summary.totalGaps,
      gapUpCount: summary.gapUpCount,
      gapDownCount: summary.gapDownCount,
      filledCount: summary.filledCount,
      unfilledCount: summary.unfilledCount,
      fillRatePercent: summary.totalGaps > 0 ? Math.round((summary.filledCount / summary.totalGaps) * 100) : 0,
      extremeGapsCount: items.filter(i => i.isExtendedGap).length,
    },
    topGaps,
    markdownContent: md,
  };
}
