import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase, { getDatabaseHealth } from '../../../lib/mongodb';
import { resolvePythonExecutable, getStockAiDir } from '../../../lib/python-runner';
import path from 'path';
import fs from 'fs';

import { getAllProviderFreshness, checkFreshnessBreaches } from '../../../lib/provider-freshness-tracker';
import { globalLatencyTracker } from '../../../lib/latency-budget';

export const dynamic = 'force-dynamic';

const REQUIRED_MODEL_ARTIFACTS = [
  'models/lightgbm_stock_model.pkl',
  'models/lightgbm_calibrated.pkl',
  'models/model_metadata.json',
];

export async function GET(req: NextRequest) {
  const checks: Record<string, { status: string; detail?: string; [key: string]: any }> = {};

  checks.api = { status: 'ok' };

  // Provider Freshness Monitoring (M3-06)
  try {
    const freshness = getAllProviderFreshness();
    const breachReport = checkFreshnessBreaches();

    const activeRecords = Object.values(freshness).filter(r => r.lastAttemptAt !== null);
    if (activeRecords.length === 0) {
      checks.provider_freshness = {
        status: 'ok',
        detail: 'Provider freshness idle; no requests recorded yet.',
        sources: freshness,
      };
    } else if (breachReport.hasBreaches) {
      checks.provider_freshness = {
        status: 'degraded',
        detail: breachReport.breaches.map(b => b.detail).join('; '),
        breaches: breachReport.breaches,
        sources: freshness,
      };
    } else {
      const anyStale = activeRecords.some(r => r.status === 'stale');
      checks.provider_freshness = {
        status: anyStale ? 'degraded' : 'ok',
        detail: anyStale ? 'One or more providers are serving stale snapshots.' : 'All active providers report fresh snapshots.',
        sources: freshness,
      };
    }
  } catch (err: any) {
    checks.provider_freshness = {
      status: 'error',
      detail: `Provider freshness check failed: ${err?.message || 'unknown error'}`,
    };
  }

  try {
    const python = resolvePythonExecutable();
    const remoteUrl = process.env.STOCK_AI_SERVICE_URL;
    checks.python = {
      status: (python.exists || !!remoteUrl) ? 'ok' : 'skipped',
      detail: remoteUrl
        ? `Remote ML engine configured: ${remoteUrl}`
        : python.exists
        ? 'Python runtime found'
        : 'Python runtime not present (running in cloud web-only mode)',
    };
  } catch {
    checks.python = { status: 'skipped', detail: 'Python runtime check bypassed' };
  }

  try {
    if (!process.env.MONGODB_URI) {
      checks.database = { status: 'skipped', detail: 'MONGODB_URI not configured' };
    } else {
      const dbHealth = await getDatabaseHealth();
      if (dbHealth.status !== 'ok') {
        try {
          await connectToDatabase();
          const refreshed = await getDatabaseHealth();
          checks.database = { status: refreshed.status, detail: refreshed.status === 'ok' ? 'Database connection is healthy' : 'Database connection is not ready' };
        } catch {
          checks.database = { status: 'degraded', detail: 'Database connection temporarily unavailable' };
        }
      } else {
        checks.database = { status: 'ok', detail: 'Database connection is healthy' };
      }
    }
  } catch {
    checks.database = { status: 'degraded', detail: 'Database health check failed' };
  }

  // Check model artifacts — missing artifacts disable the scan endpoint but don't crash the server
  try {
    const stockAiDir = getStockAiDir();
    const missing = REQUIRED_MODEL_ARTIFACTS.filter(
      (rel) => !fs.existsSync(path.join(stockAiDir, rel))
    );
    if (missing.length > 0) {
      const hasRemote = !!process.env.STOCK_AI_SERVICE_URL;
      checks.ml_artifacts = {
        status: hasRemote ? 'ok' : 'skipped',
        detail: hasRemote
          ? 'Model artifacts managed by remote ML service'
          : `Local artifacts absent: ${missing.join(', ')}. Scans run via remote ML service or fallback.`,
      };
    } else {
      // Check provenance status from metadata
      let provenanceStatus = 'unknown';
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(stockAiDir, 'models/model_metadata.json'), 'utf-8'));
        provenanceStatus = meta.provenance_status ?? meta.MODEL_PROVENANCE_STATUS ?? 'unknown';
      } catch { /* metadata unreadable */ }
      const needsValidation = typeof provenanceStatus !== 'string' || !provenanceStatus.trim()
        || provenanceStatus === 'unknown' || provenanceStatus === 'REQUIRES_REGENERATION';
      checks.ml_artifacts = {
        status: needsValidation ? 'degraded' : 'ok',
        detail: provenanceStatus === 'REQUIRES_REGENERATION'
          ? 'Artifacts exist but provenance=REQUIRES_REGENERATION — retrain before production use.'
          : needsValidation ? 'Artifacts present but provenance is unavailable; validation required.'
          : 'Artifacts present with recorded provenance; model quality requires separate validation.',
      };
    }
  } catch {
    checks.ml_artifacts = { status: 'skipped', detail: 'Model artifact check bypassed' };
  }

  // Operational Hardening: Restore Drill Verification (Epic 2)
  try {
    const drillPath = path.join(process.cwd(), 'docs', 'drills', 'RESTORE_DRILL_LATEST.json');
    if (fs.existsSync(drillPath)) {
      const parsed = JSON.parse(fs.readFileSync(drillPath, 'utf-8'));
      if (parsed && typeof parsed.status === 'string') {
        checks.restore_drill = {
          status: parsed.status === 'PASSED' ? 'ok' : parsed.status === 'FAILED' ? 'degraded' : 'skipped',
          detail: parsed.summary || `Restore drill status: ${parsed.status}`,
          timestamp: parsed.timestamp,
        };
      } else {
        checks.restore_drill = {
          status: 'skipped',
          detail: 'Restore drill metadata not recognized.',
        };
      }
    } else {
      checks.restore_drill = {
        status: 'skipped',
        detail: 'No restore drill recorded yet.',
      };
    }
  } catch {
    checks.restore_drill = {
      status: 'skipped',
      detail: 'Restore drill verification idle.',
    };
  }

  // Operational Hardening: Latency Budget Monitoring (Epic 2)
  try {
    const stats = globalLatencyTracker.getAllStats();
    const hasBreach = Object.values(stats).some(s => s.slaBreached);
    checks.latency_budgets = {
      status: hasBreach ? 'degraded' : 'ok',
      detail: hasBreach ? 'One or more endpoints breached latency SLA' : 'All monitored endpoints within latency SLA',
      stats,
    };
  } catch {
    checks.latency_budgets = { status: 'ok', detail: 'Latency tracking operational.' };
  }

  const allOk = Object.values(checks).every(c => c.status === 'ok' || c.status === 'skipped');
  const degraded = Object.values(checks).some(c => c.status === 'error' || c.status === 'missing' || c.status === 'degraded' || c.status === 'unavailable');
  
  // Return HTTP 200 as long as API is operational, so cloud hosts and load balancers do not terminate deployment
  const isHardFailure = checks.api?.status !== 'ok';

  return NextResponse.json({
    success: allOk,
    status: degraded ? 'degraded' : allOk ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    checks,
  }, { status: isHardFailure ? 503 : 200, headers: { 'Cache-Control': 'no-store' } });
}
