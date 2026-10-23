import { createHash } from 'node:crypto';
import { loadSmallCapCatalog } from './small-cap-universe';
import { fetchStockQuotes, TICKER_NAMES } from './stock-fetcher';
import { analyzeRapidMove } from './rapid-move-analysis';
import { fetchNseBand } from './nse-price-band';
import type { RapidMoveCandidate } from './rapid-move-types';
import { persistRapidCandidate } from './rapid-signal-bridge';


export async function calculateRadarBatch(offset:number){
    const catalog = loadSmallCapCatalog().slice().sort((a,b) => {
      const tracked = (ticker: string) => Object.hasOwn(TICKER_NAMES, ticker.replace(/\.NS$/, ''));
      return Number(tracked(b.providerSymbol)) - Number(tracked(a.providerSymbol)) || a.providerSymbol.localeCompare(b.providerSymbol);
    });
    const revision = createHash('sha256').update(JSON.stringify(catalog)).digest('hex').slice(0,20);
    const batch = catalog.slice(offset, offset + 24);
    const quotes = await fetchStockQuotes(batch.map(row => row.providerSymbol));
    if(batch.length&&quotes.every(quote=>!quote))throw new Error('All quotes in this radar batch are unavailable; previous snapshot retained.');
    const candidates: RapidMoveCandidate[] = [];
    quotes.forEach((quote, i) => {
      if (!quote) return;
      const pick = analyzeRapidMove(quote, batch[i].name, batch[i].series);
      if (pick) {pick.series=batch[i].series;candidates.push(pick);}
    });
    // Bounded parallel exchange lookups; unavailable bands remain explicitly unknown.
    await Promise.all(candidates.filter(c => c.circuitMomentum).sort((a,b) => b.score-a.score).slice(0,4).map(async candidate => {
      candidate.band = await fetchNseBand(candidate.ticker, candidate.asOf);
      if (candidate.band) candidate.risks = candidate.risks.filter(r => !r.startsWith('Circuit band unverified'));
      if (candidate.band?.dynamic) candidate.risks.push('Dynamic operating range can flex; this is not a fixed upper circuit.');
      if (candidate.band && !candidate.band.dynamic && candidate.price >= candidate.band.upper * .995) candidate.risks.push('Near upper circuit: a buy order may remain unfilled.');
    }));
    for (const pick of candidates) pick.signalId = await persistRapidCandidate(pick);
return { candidates, scannedTickers:batch.map(row=>row.providerSymbol), evaluatedTickers:batch.filter((_,i)=>quotes[i]!==null).map(row=>row.providerSymbol), scanned:batch.length, unavailable:quotes.filter(q=>!q).length,total:catalog.length,nextOffset:offset+batch.length<catalog.length?offset+batch.length:null,catalogRevision:revision,fetchedAt:new Date().toISOString()};
}
