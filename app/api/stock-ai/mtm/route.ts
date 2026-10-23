import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, verifyRequestOrigin } from '../../../../lib/auth-guard';
import { executePythonScript, getStockAiDir } from '../../../../lib/python-runner';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';

const VALID_ACTIONS = new Set([
  'sync',
  'sync_from_broker',
  'close_position',
  'simulate_tick',
  'scenario',
  'check_exits',
]);

const VALID_SCENARIOS = new Set(['live', 'bullish', 'mixed', 'bearish']);
const TICKER_REGEX = /^[A-Za-z0-9._-]{1,25}$/;

function loadMtmData(stockAiDir: string) {
  const positionsPath = path.join(stockAiDir, 'outputs', 'paper_trading', 'active_positions.json');
  const journalPath = path.join(stockAiDir, 'outputs', 'paper_trading', 'trade_journal.json');
  const summaryPath = path.join(stockAiDir, 'outputs', 'paper_trading', 'mtm_summary.json');

  let positions: any = null;
  let journal: any = null;
  let summary: any = null;

  if (fs.existsSync(positionsPath)) {
    try {
      positions = JSON.parse(fs.readFileSync(positionsPath, 'utf-8'));
    } catch (e: any) {
      console.warn('Error reading active_positions.json:', e.message);
    }
  }

  if (fs.existsSync(journalPath)) {
    try {
      journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
    } catch (e: any) {
      console.warn('Error reading trade_journal.json:', e.message);
    }
  }

  if (fs.existsSync(summaryPath)) {
    try {
      summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    } catch (e: any) {
      console.warn('Error reading mtm_summary.json:', e.message);
    }
  }

  return { positions, journal, summary };
}

export async function GET() {
  try {
    const stockAiDir = getStockAiDir();
    const data = loadMtmData(stockAiDir);

    return NextResponse.json({
      success: true,
      ...data,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch MTM portfolio data' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!verifyRequestOrigin(request)) {
      return NextResponse.json({ success: false, error: 'Invalid request origin' }, { status: 403 });
    }

    const authResult = await requireAdmin(request);
    if (!authResult.authorized) {
      return authResult.response;
    }

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || 'sync').toLowerCase();
    const symbol = body.symbol ? String(body.symbol).toUpperCase() : undefined;
    const price = body.price !== undefined ? Number(body.price) : undefined;
    const scenario = body.scenario ? String(body.scenario).toLowerCase() : undefined;
    const autoExit = body.autoExit === true;

    if (!VALID_ACTIONS.has(action)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid action: "${action}". Supported: ${Array.from(VALID_ACTIONS).join(', ')}`,
        },
        { status: 400 }
      );
    }

    if (symbol && !TICKER_REGEX.test(symbol)) {
      return NextResponse.json(
        { success: false, error: `Invalid symbol format: "${symbol}".` },
        { status: 400 }
      );
    }

    if (action === 'simulate_tick') {
      if (!symbol || price === undefined || isNaN(price) || price <= 0) {
        return NextResponse.json(
          { success: false, error: 'simulate_tick requires a valid symbol and positive numeric price.' },
          { status: 400 }
        );
      }
    }

    if (action === 'close_position' && !symbol) {
      return NextResponse.json(
        { success: false, error: 'close_position requires a target symbol.' },
        { status: 400 }
      );
    }

    if (action === 'scenario' && scenario && !VALID_SCENARIOS.has(scenario)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid scenario: "${scenario}". Supported: ${Array.from(VALID_SCENARIOS).join(', ')}`,
        },
        { status: 400 }
      );
    }

    const args: string[] = [];

    if (action === 'sync_from_broker') {
      args.push('--sync-from-broker', '--keep-open');
    } else if (action === 'close_position' && symbol) {
      args.push('--close-position', symbol);
    } else if (action === 'simulate_tick' && symbol && price !== undefined) {
      args.push('--simulate-tick', symbol, String(price));
    } else if (action === 'scenario' && scenario) {
      args.push('--scenario', scenario);
      if (!autoExit) args.push('--keep-open');
    } else if (action === 'check_exits') {
      args.push('--auto-exit');
    } else {
      args.push('--sync');
      if (!autoExit) args.push('--keep-open');
    }

    const execResult = await executePythonScript({
      scriptName: 'mtm_tracker.py',
      args,
      timeoutMs: 30000,
      lockKey: 'stock-ai-mtm',
      requiredArtifacts: [
        'outputs/paper_trading/active_positions.json',
        'outputs/paper_trading/mtm_summary.json',
      ],
    });

    if (!execResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'MTM tracker script failed to execute.',
          status: execResult.status,
          exitCode: execResult.exitCode,
        },
        { status: 502 }
      );
    }

    const stockAiDir = getStockAiDir();
    const data = loadMtmData(stockAiDir);

    return NextResponse.json({
      success: true,
      action,
      durationMs: execResult.durationMs,
      freshness: {
        isFresh: execResult.artifactsFresh,
        metadata: execResult.artifactMetadata,
      },
      ...data,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to execute MTM operation' },
      { status: 500 }
    );
  }
}
