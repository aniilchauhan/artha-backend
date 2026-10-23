import { fileURLToPath } from 'node:url';
import { require as tsxRequire } from 'tsx/cjs/api';
export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
process.env.AXION_PROJECT_ROOT ||= projectRoot;
const load = name => tsxRequire(fileURLToPath(new URL(`../../lib/${name}.ts`, import.meta.url)), import.meta.url);
export function status() { return { mode: 'package', available: true, serverRequired: false }; }
export async function market({limit = 6} = {}) {
  const {fetchProviderChart, normalizeChart} = await load('market-quote');
  const {fetchStocksData} = await load('stock-fetcher');
  const indices = (await Promise.all([['^NSEI','Nifty 50'],['^BSESN','Sensex'],['^NSEBANK','Bank Nifty'],['^CNXIT','Nifty IT']].map(async ([symbol,name]) => {
    try { const quote = normalizeChart(symbol, await fetchProviderChart(symbol)); return quote ? {...quote, price: quote.currentPrice, symbol, name} : null; } catch { return null; }
  }))).filter(Boolean);
  const stocks = (await fetchStocksData([], true)).filter(s => !s.isFallback).slice(0, Math.max(1,Math.min(50,limit)));
  return {indices, stocks, source: indices.length || stocks.length ? 'provider' : 'unavailable'};
}
export async function predictions({minScore = 70, limit = 5} = {}) {
  const {getArtifactProvenance} = await load('artifact-provenance');
  const provenance = getArtifactProvenance('latest_predictions.json', projectRoot);
  if (provenance.status !== 'verified') throw new Error('Prediction artifact is not verified for serving');
  const {getLatestPredictions} = await load('stock-ai-service');
  const picks = getLatestPredictions().filter(p => p['Model Score'] >= minScore).slice(0, Math.max(1, Math.min(50, limit))).map(p => ({...p, ticker:p.Ticker, score:p['Model Score'], price:p.Close_Numeric}));
  return {picks, provenance};
}
export async function paperPortfolio() {
  const {loadObservations, loadAllReconciledObservations, evaluateCohortPerformance} = await load('paper-prediction-service');
  const date = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const history = loadAllReconciledObservations();
  return {sessionDate:date, currentObservations:loadObservations(date), cohorts:['COHORT_A_CLEAN_MODEL','COHORT_B_MODEL_AND_FILINGS','COHORT_C_MODEL_FILINGS_SOCIAL'].map(c => evaluateCohortPerformance(c,history)), reconciledHistory:history.slice(-50).reverse()};
}
export async function scan() {
  const {executePythonScript} = await load('python-runner');
  const result = await executePythonScript({scriptName:'daily_scan.py',args:['--universe','core50','--fast'],timeoutMs:90000,lockKey:'stock-ai-scan',requiredArtifacts:['outputs/daily_watchlist_latest.md','outputs/latest_predictions.json']});
  if (!result.success) throw new Error(result.error || `Scanner failed (${result.status})`);
  return {success:true,status:result.status,durationMs:result.durationMs};
}
