import { NextRequest, NextResponse } from 'next/server';
import { getArtifactProvenance } from '../../../../lib/artifact-provenance';
import { getLatestPredictions } from '../../../../lib/stock-ai-service';
import { requireAdmin, verifyRequestOrigin } from '../../../../lib/auth-guard';
import { executePythonScript, getStockAiDir } from '../../../../lib/python-runner';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';

const VALID_UNIVERSES = new Set(['core50', 'nifty100', 'nifty500', 'all']);

const REQUIRED_MODEL_FILES = [
  'models/lightgbm_stock_model.pkl',
  'models/lightgbm_calibrated.pkl',
];

export async function POST(request: NextRequest) {
  try {
    if (!verifyRequestOrigin(request)) {
      return NextResponse.json({ success: false, error: 'Invalid request origin' }, { status: 403 });
    }

    const authResult = await requireAdmin(request);
    if (!authResult.authorized) {
      return authResult.response;
    }

    // Graceful degradation: refuse to scan if model artifacts are missing
    const isRemote = Boolean(process.env.STOCK_AI_SERVICE_URL);
    const stockAiDir = getStockAiDir();
    const missingArtifacts = isRemote ? [] : REQUIRED_MODEL_FILES.filter(
      (rel) => !fs.existsSync(path.join(stockAiDir, rel))
    );
    if (missingArtifacts.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Model artifacts are missing. Run stock-ai/src/train.py and stock-ai/src/calibrate.py to generate them before scanning.',
          missingArtifacts,
        },
        { status: 503 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const universe = String(body.universe || 'core50').toLowerCase();
    const topN = body.topN ? Math.min(Math.max(Number(body.topN), 1), 2500) : undefined;
    const fast = body.fast === true;

    if (!VALID_UNIVERSES.has(universe)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid universe: "${universe}". Supported: ${Array.from(VALID_UNIVERSES).join(', ')}`,
        },
        { status: 400 }
      );
    }

    const args = ['--universe', universe];
    if (topN) {
      args.push('--top-n', String(topN));
    }
    if (fast || universe === 'all') {
      args.push('--fast');
    }

    const execResult = await executePythonScript({
      scriptName: 'daily_scan.py',
      args,
      timeoutMs: 90000,
      lockKey: 'stock-ai-scan',
      requiredArtifacts: ['outputs/daily_watchlist_latest.md', 'outputs/latest_predictions.json'],
    });

    if (!execResult.success) {
      console.error('[Scanner Execution Error]', execResult);
      return NextResponse.json(
        {
          success: false,
          error: 'Market scanner script failed to execute.',
          status: execResult.status,
          exitCode: execResult.exitCode,
          durationMs: execResult.durationMs,
        },
        { status: 502 }
      );
    }

    const reportPath = path.join(stockAiDir, 'outputs', 'daily_watchlist_latest.md');
    let reportMarkdown = '';
    if (fs.existsSync(reportPath)) {
      try {
        reportMarkdown = fs.readFileSync(reportPath, 'utf-8');
      } catch (e: any) {
        console.warn('Could not read watchlist report markdown:', e.message);
      }
    }

    const predictions = getLatestPredictions();
    const provenance = getArtifactProvenance('latest_predictions.json');
    if (provenance.status !== 'verified') {
      return NextResponse.json(
        { success: false, error: 'Generated prediction artifact is not verified for serving', provenance },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'EOD Market scan completed successfully',
      scannedAt: new Date().toISOString(),
      durationMs: execResult.durationMs,
      freshness: {
        isFresh: execResult.artifactsFresh,
        metadata: execResult.artifactMetadata,
      },
      provenance,
      count: predictions.length,
      data: predictions,
      reportMarkdown,
    });
  } catch (error: any) {
    console.error('[Scanner Route Error]', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Scan execution failed' },
      { status: 500 }
    );
  }
}
