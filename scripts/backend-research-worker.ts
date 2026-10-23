import { runSnapshotJob, readSnapshot } from '../lib/backend-snapshots';
import { calculateWholeMarket } from '../lib/backend-market-forecast';
import { calculateRadarBatch } from '../lib/backend-radar';
import { scanMarketGaps } from '../lib/gap-engine';
import { calculateSwingOpportunities } from '../lib/backend-swing';
import { generateDailyMarketSessionReport } from '../lib/market-report-generator';
import { calculateOpportunitiesSnapshot } from '../lib/backend-opportunities';
import { calculateSmallCapBatch } from '../lib/backend-small-cap';
import type { RapidMoveBatch } from '../lib/rapid-move-types';
import type { SmallCapScanResponse } from '../lib/small-cap-types';
import { getISTMarketContext } from '../lib/durable-scanner-daemon';

async function market() {
  await runSnapshotJob('whole-market', async () => {
    const data = await calculateWholeMarket();
    const evaluated = data.indices.filter(i => i.available).length;
    if (!evaluated) throw new Error('No valid index observations; previous forecast preserved.');
    return { data, marketDataAsOf: data.indices.map(i => i.quoteAsOf).filter(Boolean).sort()[0] ?? null, coverage: { evaluated, total: 3 } };
  });
}

async function gaps() {
  await runSnapshotJob('gap-screener', async () => {
    const data = await scanMarketGaps();
    if (!data.source || !data.coverage.evaluated) throw new Error('No valid provider OHLC observations; previous snapshot retained.');
    return { data, marketDataAsOf: data.source.quoteAsOf, coverage: data.coverage };
  });
}

async function radar() {
  await runSnapshotJob('rapid-moves', async () => {
    let checkpoint: RapidMoveBatch | null = null;
    try { checkpoint = (await readSnapshot<RapidMoveBatch>('rapid-moves', true)).data; }
    catch { try { checkpoint = (await readSnapshot<RapidMoveBatch>('rapid-moves')).data; } catch {} }
    let offset = checkpoint?.nextOffset ?? 0;
    let batch = await calculateRadarBatch(offset);
    if (checkpoint && checkpoint.catalogRevision !== batch.catalogRevision) {
      offset = 0; checkpoint = null; batch = await calculateRadarBatch(0);
    }
    const prior = checkpoint && batch.catalogRevision === checkpoint.catalogRevision && offset > 0 ? checkpoint : null;
    const data: RapidMoveBatch = {
      ...batch,
      candidates: [...(prior?.candidates ?? []), ...batch.candidates],
      scannedTickers: [...(prior?.scannedTickers ?? []), ...batch.scannedTickers],
      evaluatedTickers: [...(prior?.evaluatedTickers ?? []), ...batch.evaluatedTickers],
      scanned: (prior?.scanned ?? 0) + batch.scanned,
      unavailable: (prior?.unavailable ?? 0) + batch.unavailable,
    };
    let publish = true;
    if (data.nextOffset !== null) {
      try { publish = (await readSnapshot<RapidMoveBatch>('rapid-moves')).data.nextOffset !== null; }
      catch {}
    }
    return {
      data,
      publish,
      marketDataAsOf: data.candidates.map(c => c.asOf).sort()[0] ?? null,
      coverage: { evaluated: data.evaluatedTickers.length, total: data.total },
    };
  });
}

async function swing() {
  await runSnapshotJob('swing-opportunities', async () => {
    return calculateSwingOpportunities();
  });
}

async function marketReport() {
  await runSnapshotJob('market-session-report', async () => {
    const report = await generateDailyMarketSessionReport();
    return {
      data: report,
      marketDataAsOf: report.source.quoteAsOf,
      coverage: { evaluated: report.universeScanned, total: report.universeTotal },
    };
  });
}

async function opportunities() {
  await runSnapshotJob('opportunities', async () => {
    return calculateOpportunitiesSnapshot();
  });
}

async function smallCap() {
  await runSnapshotJob('small-cap-predictions', async () => {
    let checkpoint: SmallCapScanResponse | null = null;
    try { checkpoint = (await readSnapshot<SmallCapScanResponse>('small-cap-predictions', true)).data; }
    catch { try { checkpoint = (await readSnapshot<SmallCapScanResponse>('small-cap-predictions')).data; } catch {} }
    let offset = checkpoint?.nextOffset ?? 0;
    let batch = await calculateSmallCapBatch(offset, 'all');
    if (checkpoint && checkpoint.catalogRevision !== batch.catalogRevision) {
      offset = 0; checkpoint = null; batch = await calculateSmallCapBatch(0, 'all');
    }
    const prior = checkpoint && batch.catalogRevision === checkpoint.catalogRevision && offset > 0 ? checkpoint : null;
    const allStocks = [...(prior?.stocks ?? []), ...batch.stocks];
    const data: SmallCapScanResponse = {
      ...batch,
      stocks: allStocks,
      counts: {
        ...batch.counts,
        scanned: (prior?.counts.scanned ?? 0) + batch.counts.scanned,
        quotesUnavailable: (prior?.counts.quotesUnavailable ?? 0) + batch.counts.quotesUnavailable,
        staleQuotes: (prior?.counts.staleQuotes ?? 0) + batch.counts.staleQuotes,
        unknownMarketCaps: (prior?.counts.unknownMarketCaps ?? 0) + batch.counts.unknownMarketCaps,
        notSmallCap: (prior?.counts.notSmallCap ?? 0) + batch.counts.notSmallCap,
        smallCaps: (prior?.counts.smallCaps ?? 0) + batch.counts.smallCaps,
        insufficientHistory: (prior?.counts.insufficientHistory ?? 0) + batch.counts.insufficientHistory,
      },
    };
    let publish = true;
    if (data.nextOffset !== null) {
      try { publish = (await readSnapshot<SmallCapScanResponse>('small-cap-predictions')).data.nextOffset !== null; }
      catch {}
    }
    return {
      data,
      publish,
      marketDataAsOf: data.stocks.map(s => s.quoteAsOf).filter(Boolean).sort()[0] ?? null,
      coverage: { evaluated: data.stocks.length, total: data.counts.totalCatalog },
    };
  });
}

let busy = false, initial = true;

async function cycle() {
  if (busy) return;
  busy = true;
  try {
    const offHours = ['OFF_HOURS', 'WEEKEND'].includes(getISTMarketContext().phase);
    const jobs = [
      ['whole-market', market],
      ['gap-screener', gaps],
      ['rapid-moves', radar],
      ['swing-opportunities', swing],
      ['market-session-report', marketReport],
      ['opportunities', opportunities],
      ['small-cap-predictions', smallCap],
    ] as const;

    for (const [job, run] of jobs) {
      if (offHours && !initial) {
        if (job === 'rapid-moves') {
          try { if ((await readSnapshot<RapidMoveBatch>('rapid-moves', true)).data.nextOffset === null) continue; } catch {}
        } else if (job === 'small-cap-predictions') {
          try { if ((await readSnapshot<SmallCapScanResponse>('small-cap-predictions', true)).data.nextOffset === null) continue; } catch {}
        } else {
          continue;
        }
      }
      try {
        await run();
        process.stdout.write(JSON.stringify({ job, state: 'cycle_completed', at: new Date().toISOString() }) + '\n');
      } catch (error) {
        process.stderr.write(JSON.stringify({ job, state: 'failed', error: String(error) }) + '\n');
      }
    }
  } finally {
    busy = false;
    initial = false;
  }
}

void cycle().then(() => {
  if (!process.argv.includes('--once')) setInterval(() => void cycle(), 60_000);
});
