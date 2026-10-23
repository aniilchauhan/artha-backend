import { NextRequest, NextResponse } from 'next/server';
import os from 'os';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { getDatabaseHealth } from '../../../../lib/mongodb';
import { getAllProviderFreshness, checkFreshnessBreaches } from '../../../../lib/provider-freshness-tracker';
import { globalScanWorkloadLimiter, globalBacktestWorkloadLimiter } from '../../../../lib/workload-limiter';

export const dynamic = 'force-dynamic';

export interface OperationalMetricsResponse {
  timestamp: string;
  status: 'healthy' | 'degraded' | 'critical';
  uptimeSeconds: number;
  system: {
    platform: string;
    nodeVersion: string;
    cpus: number;
    loadAverage: number[];
    freeMemoryBytes: number;
    totalMemoryBytes: number;
    processMemory: {
      rssBytes: number;
      heapTotalBytes: number;
      heapUsedBytes: number;
      externalBytes: number;
      heapUsedPercent: number;
    };
  };
  eventLoop: {
    lagMs: number;
    status: 'optimal' | 'lagging' | 'critical';
  };
  database: {
    status: string;
    readyState: number;
    readyStateLabel: string;
    detail?: string;
  };
  workloadQueues: {
    scanner: {
      activeJobs: number;
      queuedJobs: number;
      maxConcurrent: number;
      maxQueueSize: number;
      totalAccepted: number;
      totalRejected: number;
      totalCompleted: number;
      totalTimedOut: number;
    };
    backtest: {
      activeJobs: number;
      queuedJobs: number;
      maxConcurrent: number;
      maxQueueSize: number;
      totalAccepted: number;
      totalRejected: number;
      totalCompleted: number;
      totalTimedOut: number;
    };
  };
  providerFreshness: {
    status: 'ok' | 'degraded' | 'error';
    breachCount: number;
    breaches: Array<{ source: string; detail: string }>;
    sources: Record<string, any>;
  };
  storage: {
    stockAiExists: boolean;
    predictionsDirExists: boolean;
    backupsDirExists: boolean;
  };
}

/**
 * Measure event loop lag asynchronously.
 */
function measureEventLoopLag(): Promise<number> {
  return new Promise((resolve) => {
    const start = hrtimeMs();
    setImmediate(() => {
      const lag = hrtimeMs() - start;
      resolve(Math.max(0, Math.round(lag * 100) / 100));
    });
  });
}

function hrtimeMs(): number {
  const [sec, nano] = process.hrtime();
  return sec * 1000 + nano / 1e6;
}

const READY_STATE_MAP: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

export async function GET(req: NextRequest) {
  const eventLoopLagMs = await measureEventLoopLag();
  const mem = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  // Database status
  const dbHealth = await getDatabaseHealth();
  const readyStateLabel = READY_STATE_MAP[dbHealth.readyState] ?? 'unknown';

  // Provider freshness
  const freshness = getAllProviderFreshness();
  const breachReport = checkFreshnessBreaches();

  // Storage directories check
  const projectRoot = process.cwd();
  const stockAiExists = fs.existsSync(path.join(projectRoot, 'stock_ai'));
  const predictionsDirExists = fs.existsSync(path.join(projectRoot, 'data/predictions'));
  const backupsDirExists = fs.existsSync(path.join(projectRoot, 'backups'));

  const scannerStats = globalScanWorkloadLimiter.getStats();
  const backtestStats = globalBacktestWorkloadLimiter.getStats();

  // Compute status rollup
  let overallStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';

  if (
    breachReport.hasBreaches ||
    eventLoopLagMs > 150 ||
    mem.heapUsed / mem.heapTotal > 0.90 ||
    scannerStats.queuedJobs > 10
  ) {
    overallStatus = 'degraded';
  }

  if (
    (process.env.MONGODB_URI && dbHealth.status === 'error') ||
    eventLoopLagMs > 500
  ) {
    overallStatus = 'critical';
  }

  const response: OperationalMetricsResponse = {
    timestamp: new Date().toISOString(),
    status: overallStatus,
    uptimeSeconds: Math.floor(process.uptime()),
    system: {
      platform: `${os.type()} ${os.release()}`,
      nodeVersion: process.version,
      cpus: os.cpus().length,
      loadAverage: os.loadavg ? os.loadavg() : [0, 0, 0],
      freeMemoryBytes: freeMem,
      totalMemoryBytes: totalMem,
      processMemory: {
        rssBytes: mem.rss,
        heapTotalBytes: mem.heapTotal,
        heapUsedBytes: mem.heapUsed,
        externalBytes: mem.external,
        heapUsedPercent: Math.round((mem.heapUsed / mem.heapTotal) * 100),
      },
    },
    eventLoop: {
      lagMs: eventLoopLagMs,
      status: eventLoopLagMs < 30 ? 'optimal' : eventLoopLagMs < 100 ? 'lagging' : 'critical',
    },
    database: {
      status: dbHealth.status,
      readyState: dbHealth.readyState,
      readyStateLabel,
      detail: dbHealth.detail,
    },
    workloadQueues: {
      scanner: scannerStats,
      backtest: backtestStats,
    },
    providerFreshness: {
      status: breachReport.hasBreaches ? 'degraded' : 'ok',
      breachCount: breachReport.breaches.length,
      breaches: breachReport.breaches,
      sources: freshness,
    },
    storage: {
      stockAiExists,
      predictionsDirExists,
      backupsDirExists,
    },
  };

  return NextResponse.json(response, {
    status: overallStatus === 'critical' ? 503 : 200,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
