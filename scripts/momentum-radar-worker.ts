/**
 * Axion 5-Minute Momentum Radar & Immediate Spike Daemon Worker
 *
 * Runs locally to evaluate:
 * 1. The #1 top stock of every 5-minute cycle (+2% Day Return or +10% Circuit Runner)
 * 2. Instant anomalies (immediate spikes < 5 minutes)
 *
 * Usage:
 *   node --import tsx scripts/momentum-radar-worker.ts
 *   node --import tsx scripts/momentum-radar-worker.ts --once
 */

import { evaluateMomentumRadar } from '../lib/momentum-radar-engine';

const isOnce = process.argv.includes('--once');

async function runTick() {
  const now = Date.now();
  const timeStr = new Date(now).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });

  try {
    const snapshot = await evaluateMomentumRadar(now);

    console.log(`\n======================================================`);
    console.log(`[RADAR ${timeStr} IST] 5-Minute Cycle Evaluation Complete`);
    console.log(`======================================================`);

    if (snapshot.topPick) {
      const p = snapshot.topPick;
      const typeLabel = p.targetType === '10_PERCENT_SURGE' ? '🚀 +10% CIRCUIT RUNNER' : '🎯 +2% INTRADAY BREAKOUT';
      console.log(`\n🏆 TOP 5-MIN PICK: ${p.ticker} (${p.name})`);
      console.log(`   Type: ${typeLabel}`);
      console.log(`   Current: ₹${p.currentPrice.toFixed(2)} | Target: ₹${p.targetPrice.toFixed(2)} (+${p.targetPct.toFixed(1)}%)`);
      console.log(`   Stop Loss: ₹${p.stopLossPrice.toFixed(2)} | Conviction: ${p.convictionScore}%`);
      console.log(`   Setup: ${p.setupSummary}`);
      console.log(`   Breakout Trigger: ${p.breakoutTrigger}`);
    } else {
      console.log(`   No high-conviction candidate identified in current market cycle.`);
    }

    if (snapshot.activeSpikes && snapshot.activeSpikes.length > 0) {
      console.log(`\n⚡ ACTIVE IMMEDIATE SPIKES (< 5 MIN TRIGGER):`);
      for (const spike of snapshot.activeSpikes) {
        console.log(`   🔥 ${spike.ticker}: ₹${spike.currentPrice.toFixed(2)} (${spike.headline})`);
        console.log(`      Reason: ${spike.reason}`);
      }
    }

    console.log(`\nNext 5-minute evaluation scheduled at: ${new Date(snapshot.nextCycleAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
    console.log(`======================================================\n`);
  } catch (err: any) {
    console.error(`[RADAR ERROR] Tick failed:`, err?.message);
  }
}

async function main() {
  console.log(`Initializing Axion 5-Minute Momentum Radar Worker...`);
  console.log(`Mode: ${isOnce ? 'Single-Execution (--once)' : 'Continuous Monitoring (30s anomaly ticks + 5-min cycles)'}`);

  if (isOnce) {
    await runTick();
    process.exit(0);
  }

  // Initial cycle
  await runTick();

  // Continuous monitoring loop: checks every 30 seconds
  setInterval(async () => {
    await runTick();
  }, 30_000);
}

main().catch(console.error);
