#!/usr/bin/env node
/**
 * Axion Market Session Automation Daemon
 *
 * Coordinates daily lifecycle operations in Asia/Calcutta (IST) time:
 * - 09:10 - 09:14 IST: No legacy cohort snapshot action (retired)
 * - 09:15 - 15:30 IST: Intraday alert worker polling & gap monitoring
 * - 15:31 - 15:45 IST: Research outcome reconciliation & daily gap report
 * - Off-hours: Idle heartbeat monitoring
 *
 * Usage:
 *   node scripts/market-session-daemon.mjs --once
 *   node scripts/market-session-daemon.mjs --daemon
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const isDaemon = args.includes('--daemon');
let lastHorizonReconcileDate = null;

export function getIndianMarketTime() {
  const now = new Date();
  const istString = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  const istDate = new Date(istString);
  const hours = istDate.getHours();
  const minutes = istDate.getMinutes();
  const day = istDate.getDay(); // 0 is Sunday, 6 is Saturday
  const timeNum = hours * 100 + minutes; // e.g. 0914 -> 914, 1530 -> 1530
  const dateStr = istDate.toISOString().split('T')[0];

  return {
    hours,
    minutes,
    timeNum,
    day,
    isWeekend: day === 0 || day === 6,
    dateStr,
    timestamp: istDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

export function determineSessionPhase(timeNum, isWeekend) {
  if (isWeekend) return 'WEEKEND_OFF_HOURS';
  if (timeNum >= 910 && timeNum < 915) return 'PRE_MARKET_WINDOW';
  if (timeNum >= 915 && timeNum <= 1530) return 'MARKET_HOURS';
  if (timeNum > 1530 && timeNum <= 1600) return 'POST_MARKET_RECONCILIATION';
  return 'OFF_HOURS';
}

export async function runDaemonCycle() {
  const { timeNum, isWeekend, dateStr, timestamp } = getIndianMarketTime();
  const phase = determineSessionPhase(timeNum, isWeekend);

  console.log(`[DAEMON ${timestamp} IST] Date: ${dateStr} | Phase: ${phase}`);

  switch (phase) {
    case 'PRE_MARKET_WINDOW': {
      console.log(`[SKIP] Legacy cohort snapshots are retired. Current Radar candidates are published by the research worker.`);
      break;
    }

    case 'MARKET_HOURS': {
      console.log(`[ACTION] Exchange session active: polling alerts worker & quota locks...`);
      try {
        execSync(`node --import tsx scripts/alerts-worker.mjs --once`, {
          cwd: rootDir,
          stdio: 'inherit',
        });
      } catch (err) {
        console.error(`[ERROR] Alerts worker run failed:`, err?.message);
      }
      break;
    }

    case 'POST_MARKET_RECONCILIATION': {
      if (lastHorizonReconcileDate !== dateStr) {
        lastHorizonReconcileDate = dateStr;
        console.log(`[ACTION] Reconciling due one-week/month/year/multibagger research outcomes...`);
        try {
          execSync('node --import tsx scripts/reconcile-horizon-predictions.ts', { cwd: rootDir, stdio: 'inherit' });
        } catch (err) {
          console.error(`[ERROR] Horizon outcome reconciliation failed:`, err?.message);
        }
      }
      console.log(`[ACTION] Compiling executive daily market session briefing...`);
      try {
        execSync(`node --import tsx scripts/generate-market-report.mjs ${dateStr}`, {
          cwd: rootDir,
          stdio: 'inherit',
        });
      } catch (err) {
        console.error(`[ERROR] Report generation failed:`, err?.message);
      }
      break;
    }

    case 'WEEKEND_OFF_HOURS':
    case 'OFF_HOURS':
    default: {
      console.log(`[STATUS] Markets closed. Daemon running in heartbeat/idle mode.`);
      break;
    }
  }

  return phase;
}

async function main() {
  console.log(`======================================================`);
  console.log(`Axion Market Automation Daemon Initialized`);
  console.log(`Mode: ${isDaemon ? 'Continuous Loop (Daemon)' : 'Single Step (--once)'}`);
  console.log(`======================================================\n`);

  if (!isDaemon) {
    await runDaemonCycle();
    return;
  }

  // Continuous daemon loop
  while (true) {
    try {
      await runDaemonCycle();
    } catch (err) {
      console.error(`[DAEMON ERROR]`, err);
    }
    // Sleep 60 seconds between polling ticks
    await new Promise(resolve => setTimeout(resolve, 60_000));
  }
}

if (process.argv[1] && process.argv[1].endsWith('market-session-daemon.mjs')) {
  main().catch(console.error);
}
