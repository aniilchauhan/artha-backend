/** Durable local snapshots. The local directory is authoritative and must be backed up.
 * Atomic rename publication exposes only complete JSON; exclusive locks serialize revisions.
 * A crashed writer leaves a lock requiring operator recovery, never silent lock stealing.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getAxionProjectRoot } from './project-root';
import { validateSignal, assertSignalId } from './signal-validation';
import type { DecisionSignal } from './signal-schema';

export function getSignalsStorageDir(): string {
  const dir = path.resolve(process.env.AXION_SIGNALS_DIR || path.join(getAxionProjectRoot(), '.axion', 'signals'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readSnapshots(key?: string): DecisionSignal[] {
  const digest = key && crypto.createHash('sha256').update(key).digest('hex').slice(0,16);
  return fs.readdirSync(getSignalsStorageDir()).filter(f => /^[A-Za-z0-9_-]+\.json$/.test(f) &&
    (!digest || f.includes(`_${digest}_r`) || !/_[a-f0-9]{16}_r\d+\.json$/.test(f))).map(file => {
    // Corruption is an error, not permission to reset revision numbering.
    return JSON.parse(fs.readFileSync(path.join(getSignalsStorageDir(), file), 'utf8')) as DecisionSignal;
  });
}

export async function saveSignalSnapshot(input: DecisionSignal) {
  const signal = validateSignal(input);
  const dir = getSignalsStorageDir();
  const lockPath = path.join(dir, crypto.createHash('sha256').update(signal.deduplicationKey).digest('hex') + '.lock');
  const deadline = Date.now() + 5000;
  while (true) {
    try { fs.mkdirSync(lockPath); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() > deadline) throw new Error('Signal writer lock busy; inspect crashed writer before recovery.');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  try {
    const prior = readSnapshots(signal.deduplicationKey).filter(s => s.deduplicationKey === signal.deduplicationKey).sort((a,b) => a.revision - b.revision);
    const latest = prior.at(-1);
    if (latest?.immutableHash === signal.immutableHash) return {saved:true, revision:latest.revision, isDuplicate:true, signal:latest};
    const revision = (latest?.revision ?? 0) + 1;
    const key = crypto.createHash('sha256').update(signal.deduplicationKey).digest('hex').slice(0,16);
    const id = `sig_${signal.strategyVersion.replace(/[^a-zA-Z0-9]/g, '_')}_${signal.symbol.replace(/[^a-zA-Z0-9]/g, '_')}_${signal.dataCutoff.slice(0,10)}_${key}_r${revision}`;
    const stored = {...signal, id, revision, parentSignalId: latest?.id ?? null};
    const target = path.join(dir, `${id}.json`);
    const temp = path.join(dir, crypto.randomUUID() + '.tmp');
    const fd = fs.openSync(temp, 'wx');
    try { fs.writeFileSync(fd, JSON.stringify(stored, null, 2)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    try {
      // Every writer for this server-derived ID holds the same exclusive key lock.
      if (fs.existsSync(target)) throw new Error('Immutable signal target already exists.');
      fs.renameSync(temp, target);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    return {saved:true, revision, isDuplicate:false, signal:stored};
  } finally { fs.rmdirSync(lockPath); }
}

export async function getSignalById(id: string): Promise<DecisionSignal | null> {
  assertSignalId(id);
  const file = path.join(getSignalsStorageDir(), `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as DecisionSignal;
}

export async function getAllSignalRevisions(key: string): Promise<DecisionSignal[]> {
  return readSnapshots(key).filter(s => s.deduplicationKey === key).sort((a,b) => a.revision - b.revision);
}

export async function listRecentSignals(options: {strategyVersion?: string; limit?: number} = {}): Promise<DecisionSignal[]> {
  const latest = new Map<string, DecisionSignal>();
  for (const signal of readSnapshots()) {
    if (options.strategyVersion && signal.strategyVersion !== options.strategyVersion) continue;
    const prior = latest.get(signal.deduplicationKey);
    if (!prior || signal.revision > prior.revision) latest.set(signal.deduplicationKey, signal);
  }
  const results = [...latest.values()].sort((a,b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt));
  return results.slice(0, options.limit ?? 50);
}

export function migrateBrowserCandidate(rawItem: {
  symbol: string;
  name?: string;
  price?: number;
  addedAt?: string;
}): DecisionSignal {
  const now = new Date().toISOString();
  const symbol = (rawItem.symbol || 'UNKNOWN').toUpperCase();
  const price = rawItem.price;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) throw new Error('A dated observed browser price is required; no generated price is substituted.');

  return {
    id: `migrated_local_${symbol}_${Date.now()}`,
    deduplicationKey: `MIGRATED_LOCAL:${symbol}`,
    revision: 1,
    parentSignalId: null,
    strategyVersion: 'UNVERIFIED_LOCAL_WATCHLIST',
    signalType: 'WATCHLIST_OBSERVATION',
    state: 'watching',
    instrumentId: `NSE:${symbol}`,
    symbol,
    companyName: rawItem.name || symbol,
    series: 'EQ',
    dataCutoff: rawItem.addedAt || now,
    issuedAt: now,
    validUntil: now,
    referencePrice: price,
    quoteSource: 'Local Browser Cache (Unverified)',
    quoteStatus: 'historical',
    metrics: {
      resistance20d: price,
      volumeRatio: 1.0,
      momentum5dPct: 0.0,
      turnoverCr: 1.0,
      atr14: price * 0.02,
      atrPct: 2.0,
    },
    conditions: {
      entryTrigger: price,
      maxOpeningGap: price * 1.025,
      targetScenario: price * 1.10,
      invalidationStop: price * 0.95,
      validitySessions: 1,
      reviewSessions: 1,
      rewardToRiskRatio: 2.0,
    },
    sizing: {
      portfolioCapital: 50000,
      riskBudgetInr: 500,
      slotCapital: 16666.67,
      wholeShares: 0,
      allocatedAmount: 0,
      plannedRiskAmount: 0,
    },
    measuredReasons: [
      'Migrated from client-side browser storage.',
      'Unverified candidate: lacks server-side observation provenance.',
    ],
    evidenceMissing: [
      'Original observation snapshot is missing from server archive.',
      'Must re-evaluate against active observation contract before entering paper trial.',
    ],
    companyHoldAssessment: {
      status: 'not_established',
      label: 'Unverified local candidate',
      reason: 'Migrated from browser storage without verified financial filings.',
    },
    immutableHash: '',
  };
}
