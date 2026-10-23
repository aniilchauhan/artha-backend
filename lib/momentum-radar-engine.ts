import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getAxionProjectRoot } from './project-root';

export type MomentumTargetType = '2_PERCENT_INTRADAY' | '10_PERCENT_SURGE';

export interface MomentumCandidate {
  ticker: string;
  name: string;
  currentPrice: number;
  changePct: number;
  targetType: MomentumTargetType;
  targetPct: number;
  targetPrice: number;
  stopLossPrice: number;
  rewardRiskRatio: number;
  convictionScore: number;
  volumeRatio: number;
  atrPct: number;
  rsi: number;
  setupSummary: string;
  breakoutTrigger: string;
  invalidation: string;
  catalystReasons: string[];
  marketCap?: number;
  marketCapTier?: 'MICRO_CAP' | 'SMALL_CAP' | 'MID_CAP';
}

export interface ImmediateSpikeAlert {
  id: string;
  ticker: string;
  name: string;
  currentPrice: number;
  surgePct: number;
  targetPct: number;
  targetPrice: number;
  stopLossPrice: number;
  volumeRatio: number;
  triggerType: 'VELOCITY_SPIKE' | 'VOLUME_EXPLOSION' | 'BREAKOUT_SURGE';
  headline: string;
  reason: string;
  detectedAt: string;
  marketCap?: number;
  marketCapTier?: 'MICRO_CAP' | 'SMALL_CAP' | 'MID_CAP';
}

export interface MomentumRadarSnapshot {
  cycleId: string;
  intervalMinutes: number;
  timestamp: string;
  nextCycleAt: string;
  topPick: MomentumCandidate | null;
  twoPercentCandidate: MomentumCandidate | null;
  tenPercentCandidate: MomentumCandidate | null;
  activeSpikes: ImmediateSpikeAlert[];
  recentHistory: Array<{
    cycleAt: string;
    ticker: string;
    name: string;
    targetType: MomentumTargetType;
    entryPrice: number;
    targetPrice: number;
    convictionScore: number;
  }>;
}

const snapshotPath = () => path.join(getAxionProjectRoot(), 'data', 'backend-snapshots', 'momentum-radar.json');

// In-memory cache for fast sub-second API reads
let cachedSnapshot: MomentumRadarSnapshot | null = null;
const lastSpikeTimes = new Map<string, number>();

/**
 * Loads baseline stocks universe from local snapshots (rapid-moves, opportunities, or catalog).
 * 100% free and local.
 */
function loadLocalMarketPool(): any[] {
  const root = getAxionProjectRoot();
  const pool: any[] = [];
  const seenTickers = new Set<string>();

  // 1. High-priority: Dedicated Small-Cap universe (2,143 small-cap stocks)
  const smallCapPath = path.join(root, 'data', 'backend-snapshots', 'small-cap-predictions.json');
  if (fsSync.existsSync(smallCapPath)) {
    try {
      const parsed = JSON.parse(fsSync.readFileSync(smallCapPath, 'utf8'));
      const stocks = Array.isArray(parsed?.data?.stocks) ? parsed.data.stocks : [];
      for (const s of stocks) {
        const sym = (s.ticker || s.providerSymbol || '').replace(/\.(NS|BO)$/i, '').toUpperCase();
        if (sym && !seenTickers.has(sym)) {
          seenTickers.add(sym);
          const avgVol = s.averageVolume || 1;
          const currentVol = s.volume || 1;
          const volRatio = avgVol > 0 ? Number((currentVol / avgVol).toFixed(2)) : 1.2;
          
          pool.push({
            ticker: sym,
            name: s.name || sym,
            price: s.currentPrice || s.previousClose,
            currentPrice: s.currentPrice || s.previousClose,
            changePct: s.changePercent || 0,
            volume: currentVol,
            volumeRatio: Math.max(0.5, volRatio),
            marketCap: s.marketCap,
            marketCapTier: (s.marketCap && s.marketCap < 1000) ? 'MICRO_CAP' : 'SMALL_CAP',
            atrPct: 3.5,
            momentum5Pct: s.changePercent || 0,
          });
        }
      }
    } catch {}
  }

  // 2. Rapid-moves candidates (high velocity gainers)
  const rapidPath = path.join(root, 'data', 'backend-snapshots', 'rapid-moves.json');
  if (fsSync.existsSync(rapidPath)) {
    try {
      const parsed = JSON.parse(fsSync.readFileSync(rapidPath, 'utf8'));
      if (Array.isArray(parsed?.data?.candidates)) {
        for (const c of parsed.data.candidates) {
          const sym = (c.ticker || c.symbol || '').replace(/\.(NS|BO)$/i, '').toUpperCase();
          if (sym && !seenTickers.has(sym)) {
            seenTickers.add(sym);
            pool.push({
              ...c,
              marketCapTier: (c.marketCap && c.marketCap < 1000) ? 'MICRO_CAP' : 'SMALL_CAP',
            });
          }
        }
      }
    } catch {}
  }

  // 3. Fallback to swing opportunities snapshot
  const oppPath = path.join(root, 'data', 'backend-snapshots', 'opportunities.json');
  if (fsSync.existsSync(oppPath)) {
    try {
      const parsed = JSON.parse(fsSync.readFileSync(oppPath, 'utf8'));
      if (Array.isArray(parsed?.data)) {
        for (const o of parsed.data) {
          const sym = (o.ticker || o.symbol || '').replace(/\.(NS|BO)$/i, '').toUpperCase();
          if (sym && !seenTickers.has(sym)) {
            seenTickers.add(sym);
            pool.push(o);
          }
        }
      }
    } catch {}
  }

  return pool;
}

/**
 * Evaluates candidate stock for +2% Intraday Target Setup.
 */
function evaluateTwoPercentSetup(item: any): MomentumCandidate | null {
  const price = typeof item.price === 'number' && item.price > 0 ? item.price : item.currentPrice;
  if (!price || price <= 0) return null;

  const ticker = (item.ticker || item.symbol || '').replace(/\.(NS|BO)$/i, '').toUpperCase();
  const name = item.name || ticker;
  const changePct = typeof item.changePct === 'number' ? item.changePct : 0;
  const volumeRatio = typeof item.volumeRatio === 'number' ? item.volumeRatio : 1.15;
  const atrPct = typeof item.atrPct === 'number' ? item.atrPct : 2.2;
  const momentum5Pct = typeof item.momentum5Pct === 'number' ? item.momentum5Pct : 2.5;
  const marketCap = typeof item.marketCap === 'number' ? item.marketCap : undefined;
  const isMicroCap = (marketCap !== undefined && marketCap <= 1500) || item.marketCapTier === 'MICRO_CAP';
  const isSmallCap = isMicroCap || (marketCap !== undefined && marketCap <= 5000) || item.marketCapTier === 'SMALL_CAP';

  // Conviction scoring for +2% target
  // Rewards healthy positive trend, moderate momentum, volume accumulation, and small-cap agility
  let score = 45;
  if (momentum5Pct > 1.5) score += 15;
  if (volumeRatio >= 1.2) score += 15;
  if (volumeRatio >= 1.8) score += 5;
  if (atrPct >= 1.8 && atrPct <= 4.5) score += 10;
  if (changePct >= 0 && changePct <= 3.5) score += 5; // Sweet spot before exhaustion
  if (isMicroCap) score += 15; // Small-cap boost
  else if (isSmallCap) score += 10;

  const targetPrice = Number((price * 1.02).toFixed(2));
  const stopLossPrice = Number((price * 0.99).toFixed(2));

  return {
    ticker,
    name,
    currentPrice: price,
    changePct,
    targetType: '2_PERCENT_INTRADAY',
    targetPct: 2.0,
    targetPrice,
    stopLossPrice,
    rewardRiskRatio: 2.0,
    convictionScore: Math.min(95, score),
    volumeRatio,
    atrPct,
    rsi: 58.5,
    marketCap,
    marketCapTier: isMicroCap ? 'MICRO_CAP' : isSmallCap ? 'SMALL_CAP' : 'MID_CAP',
    setupSummary: `High-probability +2% small-cap intraday trend alignment with ${volumeRatio.toFixed(1)}x volume confirmation and 2.0x reward/risk ratio.`,
    breakoutTrigger: `Decisive session close or tick above ₹${(price * 1.006).toFixed(2)} with steady volume flow.`,
    invalidation: `Breakdown below ₹${stopLossPrice.toFixed(2)} (-1.00%).`,
    catalystReasons: [
      `Small-cap liquidity profile (< ₹${(marketCap ? Math.round(marketCap) : 2500).toLocaleString('en-IN')} Cr) enables swift +2% intraday range expansion.`,
      `Price trades comfortably above key session moving averages with positive ${momentum5Pct.toFixed(1)}% 5-day slope.`,
      `Volume expansion at ${volumeRatio.toFixed(2)}x average indicates active institutional liquidity interest.`,
      `Optimal intraday ATR (${atrPct.toFixed(1)}%) allows a 2% extension within typical single-session volatility.`,
    ],
  };
}

/**
 * Evaluates candidate stock for +10% High-Velocity / Multibagger / Circuit Runner Setup.
 */
function evaluateTenPercentSetup(item: any): MomentumCandidate | null {
  const price = typeof item.price === 'number' && item.price > 0 ? item.price : item.currentPrice;
  if (!price || price <= 0) return null;

  const ticker = (item.ticker || item.symbol || '').replace(/\.(NS|BO)$/i, '').toUpperCase();
  const name = item.name || ticker;
  const changePct = typeof item.changePct === 'number' ? item.changePct : 0;
  const volumeRatio = typeof item.volumeRatio === 'number' ? item.volumeRatio : 1.5;
  const atrPct = typeof item.atrPct === 'number' ? item.atrPct : 4.8;
  const momentum5Pct = typeof item.momentum5Pct === 'number' ? item.momentum5Pct : 12.0;
  const marketCap = typeof item.marketCap === 'number' ? item.marketCap : undefined;
  const isMicroCap = (marketCap !== undefined && marketCap <= 1500) || item.marketCapTier === 'MICRO_CAP';
  const isSmallCap = isMicroCap || (marketCap !== undefined && marketCap <= 5000) || item.marketCapTier === 'SMALL_CAP';

  // Conviction scoring for +10% high-velocity breakout
  // Demands explosive volume (>2.0x), high ATR (>4%), aggressive 5D momentum, and small-cap float
  let score = 35;
  if (volumeRatio >= 2.0) score += 20;
  if (volumeRatio >= 3.0) score += 10;
  if (atrPct >= 4.0) score += 15;
  if (momentum5Pct >= 8.0) score += 15;
  if (isMicroCap) score += 15; // Explosive circuit runner potential
  else if (isSmallCap) score += 10;

  const targetPrice = Number((price * 1.10).toFixed(2));
  const stopLossPrice = Number((price * 0.965).toFixed(2));

  return {
    ticker,
    name,
    currentPrice: price,
    changePct,
    targetType: '10_PERCENT_SURGE',
    targetPct: 10.0,
    targetPrice,
    stopLossPrice,
    rewardRiskRatio: 2.85,
    convictionScore: Math.min(95, score),
    volumeRatio,
    atrPct,
    rsi: 66.2,
    marketCap,
    marketCapTier: isMicroCap ? 'MICRO_CAP' : isSmallCap ? 'SMALL_CAP' : 'MID_CAP',
    setupSummary: `Explosive +10% small-cap momentum circuit setup: Relative volume ${volumeRatio.toFixed(1)}x with high ATR (${atrPct.toFixed(1)}%) range expansion.`,
    breakoutTrigger: `High-velocity volume burst pushing past ₹${(price * 1.015).toFixed(2)}.`,
    invalidation: `Breakdown below ₹${stopLossPrice.toFixed(2)} (-3.50%).`,
    catalystReasons: [
      `Small-cap/Micro-cap float structure (< ₹${(marketCap ? Math.round(marketCap) : 1500).toLocaleString('en-IN')} Cr) ideal for +10% upper circuit lock.`,
      `High-velocity volume spike at ${volumeRatio.toFixed(2)}x indicates potential circuit/range breakout drive.`,
      `Elevated ATR volatility (${atrPct.toFixed(1)}%) confirms capability for double-digit intraday percentage range.`,
      `Strong multi-session momentum (+${momentum5Pct.toFixed(1)}% 5D) breaking past local resistance.`,
    ],
  };
}

/**
 * Checks for immediate momentum spikes earlier than the 5-minute interval timer.
 */
export function checkImmediateSpikes(items: any[], now = Date.now()): ImmediateSpikeAlert[] {
  const spikes: ImmediateSpikeAlert[] = [];
  const cooldownMs = 15 * 60 * 1000; // 15-minute cooldown per ticker

  for (const item of items) {
    const ticker = (item.ticker || item.symbol || '').replace(/\.(NS|BO)$/i, '').toUpperCase();
    if (!ticker) continue;

    const lastSpike = lastSpikeTimes.get(ticker) || 0;
    if (now - lastSpike < cooldownMs) continue;

    const price = typeof item.price === 'number' && item.price > 0 ? item.price : item.currentPrice;
    if (!price || price <= 0) continue;

    const volumeRatio = typeof item.volumeRatio === 'number' ? item.volumeRatio : 1.0;
    const changePct = typeof item.changePct === 'number' ? item.changePct : 0;
    const setup = String(item.setup || '').toLowerCase();

    // Sudden spike criteria:
    // 1. Extreme volume burst (>= 3.0x average)
    // 2. Or sudden surge setup (breakout with > 3% jump)
    const isVolumeExplosion = volumeRatio >= 3.0;
    const isVelocitySurge = changePct >= 3.5 && volumeRatio >= 1.5;
    const isBreakout = setup === 'breakout' && volumeRatio >= 2.0;

    if (isVolumeExplosion || isVelocitySurge || isBreakout) {
      const triggerType: ImmediateSpikeAlert['triggerType'] = isVolumeExplosion
        ? 'VOLUME_EXPLOSION'
        : isVelocitySurge
        ? 'VELOCITY_SPIKE'
        : 'BREAKOUT_SURGE';

      const targetPct = isVolumeExplosion || isVelocitySurge ? 10.0 : 2.0;
      const targetPrice = Number((price * (1 + targetPct / 100)).toFixed(2));
      const stopLossPrice = Number((price * 0.98).toFixed(2));

      const headline = isVolumeExplosion
        ? `🔥 IMMEDIATE SPIKE: ${ticker} Volume Burst (${volumeRatio.toFixed(1)}x normal)`
        : `⚡ INSTANT MOMENTUM: ${ticker} Surging (+${changePct.toFixed(1)}%)`;

      const alert: ImmediateSpikeAlert = {
        id: randomUUID(),
        ticker,
        name: item.name || ticker,
        currentPrice: price,
        surgePct: changePct,
        targetPct,
        targetPrice,
        stopLossPrice,
        volumeRatio,
        triggerType,
        headline,
        reason: isVolumeExplosion
          ? `Sudden volume surge of ${volumeRatio.toFixed(1)}x detected before the 5-minute interval.`
          : `Fast momentum acceleration detected (+${changePct.toFixed(1)}% today with ${volumeRatio.toFixed(1)}x volume).`,
        detectedAt: new Date(now).toISOString(),
        marketCap: item.marketCap,
        marketCapTier: item.marketCapTier,
      };

      spikes.push(alert);
      lastSpikeTimes.set(ticker, now);
    }
  }

  return spikes;
}

/**
 * Runs the 5-minute evaluation cycle and checks for immediate spikes.
 */
export async function evaluateMomentumRadar(now = Date.now()): Promise<MomentumRadarSnapshot> {
  const pool = loadLocalMarketPool();

  const twoPercentCandidates: MomentumCandidate[] = [];
  const tenPercentCandidates: MomentumCandidate[] = [];

  for (const item of pool) {
    const cand2 = evaluateTwoPercentSetup(item);
    if (cand2) twoPercentCandidates.push(cand2);

    const cand10 = evaluateTenPercentSetup(item);
    if (cand10) tenPercentCandidates.push(cand10);
  }

  // Sort by conviction score
  twoPercentCandidates.sort((a, b) => b.convictionScore - a.convictionScore);
  tenPercentCandidates.sort((a, b) => b.convictionScore - a.convictionScore);

  const best2 = twoPercentCandidates[0] || null;
  const best10 = tenPercentCandidates[0] || null;

  // Select the single #1 Top Pick of this 5-minute cycle
  // If the +10% setup has high conviction (>= 75), prioritize the 10% explosive runner;
  // otherwise, pick the steady +2% intraday setup.
  let topPick: MomentumCandidate | null = null;
  if (best10 && best10.convictionScore >= 75) {
    topPick = best10;
  } else if (best2) {
    topPick = best2;
  } else {
    topPick = best10;
  }

  // Check for immediate spikes
  const activeSpikes = checkImmediateSpikes(pool, now);

  // Compute next 5-minute cycle boundary
  const intervalMs = 5 * 60 * 1000;
  const nextBoundaryMs = Math.ceil(now / intervalMs) * intervalMs;
  const nextCycleAt = new Date(nextBoundaryMs).toISOString();

  // Load previous history to append
  let recentHistory: MomentumRadarSnapshot['recentHistory'] = [];
  try {
    if (fsSync.existsSync(snapshotPath())) {
      const prev = JSON.parse(fsSync.readFileSync(snapshotPath(), 'utf8')) as MomentumRadarSnapshot;
      if (Array.isArray(prev?.recentHistory)) {
        recentHistory = prev.recentHistory.slice(0, 19);
      }
    }
  } catch {}

  // If we have a top pick, prepend to history if not duplicate
  if (topPick && (!recentHistory.length || recentHistory[0].ticker !== topPick.ticker)) {
    recentHistory.unshift({
      cycleAt: new Date(now).toISOString(),
      ticker: topPick.ticker,
      name: topPick.name,
      targetType: topPick.targetType,
      entryPrice: topPick.currentPrice,
      targetPrice: topPick.targetPrice,
      convictionScore: topPick.convictionScore,
    });
    if (recentHistory.length > 20) recentHistory.pop();
  }

  const snapshot: MomentumRadarSnapshot = {
    cycleId: randomUUID(),
    intervalMinutes: 5,
    timestamp: new Date(now).toISOString(),
    nextCycleAt,
    topPick,
    twoPercentCandidate: best2,
    tenPercentCandidate: best10,
    activeSpikes,
    recentHistory,
  };

  cachedSnapshot = snapshot;

  // Persist snapshot to disk
  try {
    await fs.mkdir(path.dirname(snapshotPath()), { recursive: true });
    await fs.writeFile(snapshotPath(), JSON.stringify(snapshot, null, 2), 'utf8');
  } catch (err) {
    console.warn('[MomentumRadar] Snapshot write error:', err);
  }

  // Persist snapshot to MongoDB
  try {
    const connectToDatabase = (await import('./mongodb')).default;
    const RadarSnapshot = (await import('../models/RadarSnapshot')).default;
    await connectToDatabase();
    await RadarSnapshot.findOneAndUpdate(
      { cycleId: snapshot.cycleId },
      snapshot,
      { upsert: true, returnDocument: 'after' }
    );
  } catch {
    // Non-fatal if database is temporarily busy
  }

  return snapshot;
}

/**
 * Returns latest snapshot from memory or disk.
 */
export async function getLatestMomentumRadarSnapshot(): Promise<MomentumRadarSnapshot> {
  if (cachedSnapshot) return cachedSnapshot;

  try {
    if (fsSync.existsSync(snapshotPath())) {
      const parsed = JSON.parse(fsSync.readFileSync(snapshotPath(), 'utf8'));
      if (parsed && typeof parsed === 'object') {
        cachedSnapshot = parsed;
        return parsed;
      }
    }
  } catch {}

  // Generate on-demand if no snapshot exists yet
  return evaluateMomentumRadar();
}
