import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { TICKER_NAMES } from '../lib/stock-fetcher';
import { fetchProviderChart, normalizeChart } from '../lib/market-quote';

// Audit every catalog entry against an independently fetched, timestamped quote.
// This report never rewrites historical research or promotes a snapshot to live data.
const root = process.cwd();
const refreshSnapshots = process.argv.includes('--refresh-snapshots');
const output = path.resolve(root, refreshSnapshots ? 'docs/stock-price-refresh.json' : 'docs/stock-price-audit.json');
type SavedPrice = { source: string; price: number | null; quoteAsOf: string | null };
const universe = new Map<string, SavedPrice[]>();
function add(ticker: string, price: unknown, source: string, asOf?: string) {
  if (!ticker) return;
  const symbol = /\.(NS|BO)$/.test(ticker.toUpperCase()) ? ticker.toUpperCase() : `${ticker.toUpperCase()}.NS`;
  const entries = universe.get(symbol) || [];
  entries.push({ source, price: typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null, quoteAsOf: asOf || null });
  universe.set(symbol, entries);
}
function csvLine(line: string) {
  const fields: string[] = []; let value = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted;
    } else if (line[i] === ',' && !quoted) { fields.push(value); value = ''; }
    else value += line[i];
  }
  fields.push(value); return fields;
}
for (const file of ['data/all_nse_stocks.json', 'public/all_nse_stocks.json', 'mobile/src/data/allNseStocks.json']) {
  for (const row of JSON.parse(fs.readFileSync(file, 'utf8'))) add(row.ticker, row.price ?? row.currentPrice, file, row.quoteAsOf);
}
for (const directory of ['', 'public/']) {
  for (const name of ['nse_2500_stocks_master.csv', 'axion_all_stocks_universe.csv', 'axion_full_nse_2500_stocks_master.csv']) {
    const file = directory + name;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(1).filter(Boolean)) {
      const fields = csvLine(line); add(fields[0], Number(fields[7]), file);
    }
  }
}
for (const file of ['lib/stock-data.ts', 'mobile/src/data/mockData.ts', 'lib/multibagger-engine.ts', 'lib/post-ipo-engine.ts', 'app/api/dividends/route.ts']) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  function visit(node: ts.Node) {
    if (ts.isObjectLiteralExpression(node)) {
      const properties = new Map(node.properties.filter(ts.isPropertyAssignment).map(p => [p.name.getText(source).replace(/["']/g, ''), p.initializer]));
      const ticker = properties.get('ticker'); const price = properties.get('currentPrice') ?? properties.get('price');
      if (ticker && ts.isStringLiteral(ticker) && price && ts.isNumericLiteral(price)) add(ticker.text, Number(price.text), file);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
for (const ticker of Object.keys(TICKER_NAMES)) add(ticker, null, 'lib/stock-fetcher.ts');
const startedAt = new Date().toISOString();
const symbols = [...universe.keys()].sort();
const rows: any[] = [];
let cursor = 0;
console.log(`Auditing ${symbols.length} unique symbols from all CSV, JSON and embedded price sources.`);
async function worker() {
  while (cursor < symbols.length) {
    const symbol = symbols[cursor++];
    const attempts: string[] = [];
    const chart = await fetchProviderChart(symbol, async (url, init) => {
      try {
        const response = await fetch(url, init); attempts.push(String(response.status)); return response;
      } catch (error: any) { attempts.push(error.name || 'network_error'); throw error; }
    });
    const q = normalizeChart(symbol, chart);
    const saved = universe.get(symbol)!;
    const comparisons = saved.map(entry => ({ ...entry,
      difference: q && entry.price !== null ? Number((entry.price - q.currentPrice).toFixed(4)) : null,
      matches: q && entry.price !== null ? Math.abs(entry.price - q.currentPrice) <= 0.051 : null,
    }));
    rows.push({ symbol, observation: q ? { ...q, history: undefined } : null, status: q ? 'provider_observation' : 'unavailable', attempts,
      providerPrice: q?.currentPrice ?? null, quoteAsOf: q?.quoteAsOf ?? null, fetchedAt: q?.fetchedAt ?? null,
      quoteStatus: q?.quoteStatus ?? 'unavailable', providerName: chart?.meta?.longName ?? chart?.meta?.shortName ?? null,
      ageDays: q ? Number(((Date.now() - Date.parse(q.quoteAsOf)) / 86400000).toFixed(2)) : null,
      storedPriceConflict: new Set(saved.map(s => s.price).filter(p => p !== null)).size > 1,
      comparisons });
    if (rows.length % 100 === 0 || rows.length === symbols.length) {
      console.log(`${rows.length}/${symbols.length} checked; ${rows.filter(r => r.status === 'unavailable').length} unavailable`);
      save();
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
function save() {
  const summary = {
    totalSymbols: symbols.length, checkedSymbols: rows.length,
    providerObservations: rows.filter(r => r.status === 'provider_observation').length,
    unavailable: rows.filter(r => r.status === 'unavailable').length,
    storedPriceConflicts: rows.filter(r => r.storedPriceConflict).length,
    symbolsWithMismatches: rows.filter(r => r.comparisons.some((c: any) => c.matches === false)).length,
    observationsOlderThan7Days: rows.filter(r => r.ageDays !== null && r.ageDays > 7).length,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ startedAt, completedAt: rows.length === symbols.length ? new Date().toISOString() : null,
    scope: 'All 2,571 catalog stocks plus additional symbols embedded in price-serving code',
    methodology: 'Yahoo Finance chart metadata checked for symbol, INR currency, timestamp and complete normalized price evidence. Differences compare untimestamped stored snapshots to provider observations; they are not proof of a provider error. Unavailable and old observations are not verified current prices.',
    summary, rows: [...rows].sort((a, b) => a.symbol.localeCompare(b.symbol)).map(row => refreshSnapshots ? { symbol: row.symbol, status: row.status, observation: row.observation } : row) }, null, 2) + '\n');
  return summary;
}
Promise.all(Array.from({length: 8}, worker)).then(() => { if (refreshSnapshots) updateSnapshots(); console.log(JSON.stringify(save(), null, 2)); }).catch(error => { save(); console.error(error); process.exitCode = 1; });

function updateSnapshots() {
  if (rows.length !== symbols.length) throw new Error('Refusing to update catalogs from an incomplete audit');
  const quotes = new Map(rows.map(row => [row.symbol, row.observation]));
  for (const file of ['data/all_nse_stocks.json', 'public/all_nse_stocks.json', 'mobile/src/data/allNseStocks.json']) {
    const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
    const updated = catalog.map((row: any) => {
      const q = quotes.get(row.ticker);
      return { ...row, currentPrice: q?.currentPrice ?? null, price: q?.currentPrice ?? 0,
        change: q?.change ?? 0, changePercent: q?.changePercent ?? 0,
        high: q?.high ?? null, low: q?.low ?? null, volume: q?.volume ?? null,
        previousClose: q?.previousClose ?? null, providerSymbol: q?.providerSymbol ?? null,
        currency: q?.currency ?? null, quoteAsOf: q?.quoteAsOf ?? null, fetchedAt: q?.fetchedAt ?? null,
        sessionStart: q?.sessionStart ?? null, sessionEnd: q?.sessionEnd ?? null,
        dataSource: q ? 'provider' : 'unavailable', quoteStatus: q?.quoteStatus ?? 'unavailable',
        isFallback: !q, isPriceVerified: !!q, tradeLevels: undefined };
    });
    fs.writeFileSync(file, JSON.stringify(updated) + '\n');
  }
  const encode = (field: string) => /[",\r\n]/.test(field) ? '"' + field.replace(/"/g, '""') + '"' : field;
  for (const directory of ['', 'public/']) {
    for (const name of ['nse_2500_stocks_master.csv', 'axion_all_stocks_universe.csv', 'axion_full_nse_2500_stocks_master.csv']) {
      const file = directory + name;
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(csvLine);
      const headers = lines[0];
      const extra = ['Quote As Of', 'Quote Fetched At', 'Price Source', 'Quote Status'];
      for (const field of extra) if (!headers.includes(field)) headers.push(field);
      for (const fields of lines.slice(1)) {
        const q = quotes.get(fields[0]);
        fields[7] = q ? String(q.currentPrice) : '';
        fields[8] = q ? String(Number(q.changePercent.toFixed(4))) + '%' : '';
        fields[9] = q ? String(Number(q.change.toFixed(4))) : '';
        [q?.quoteAsOf ?? '', q?.fetchedAt ?? '', q ? 'provider' : 'unavailable', q?.quoteStatus ?? 'unavailable']
          .forEach((value, index) => { fields[headers.indexOf(extra[index])] = value; });
      }
      fs.writeFileSync(file, lines.map(fields => fields.map(encode).join(',')).join('\n') + '\n');
    }
  }
  console.log('Refreshed all nine catalog copies with timestamped observations; missing quotes remain unavailable.');
}
