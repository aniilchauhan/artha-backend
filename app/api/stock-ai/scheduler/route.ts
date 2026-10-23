import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, verifyRequestOrigin } from '../../../../lib/auth-guard';
import { executePythonScript, getStockAiDir } from '../../../../lib/python-runner';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';

const VALID_ACTIONS = new Set(['run-now', 'install-task', 'uninstall-task']);
const VALID_UNIVERSES = new Set(['core50', 'nifty100', 'nifty500', 'all']);

export async function GET() {
  try {
    const stockAiDir = getStockAiDir();
    const statusFile = path.join(stockAiDir, 'outputs', 'scheduler_status.json');

    let status: any = {
      pipeline_status: 'READY',
      last_run_timestamp: null,
      next_scheduled_run: '15:45:00 IST (NSE Trading Days)',
      windows_task: {
        registered: false,
        task_name: 'AxionStockAIScanner',
        status: 'NOT_REGISTERED',
      },
    };

    if (fs.existsSync(statusFile)) {
      try {
        status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      } catch (e: any) {
        console.warn('Error reading scheduler_status.json:', e.message);
      }
    }

    return NextResponse.json({
      success: true,
      data: status,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch scheduler status' },
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
    const action = String(body.action || 'run-now').toLowerCase();
    const universe = String(body.universe || 'core50').toLowerCase();

    if (!VALID_ACTIONS.has(action)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid action: "${action}". Supported: ${Array.from(VALID_ACTIONS).join(', ')}`,
        },
        { status: 400 }
      );
    }

    if (action === 'run-now' && !VALID_UNIVERSES.has(universe)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid universe: "${universe}". Supported: ${Array.from(VALID_UNIVERSES).join(', ')}`,
        },
        { status: 400 }
      );
    }

    let args: string[] = [];
    if (action === 'install-task') {
      args = ['--install-task'];
    } else if (action === 'uninstall-task') {
      args = ['--uninstall-task'];
    } else {
      args = ['--run-now', '--universe', universe];
    }

    const execResult = await executePythonScript({
      scriptName: 'scheduler.py',
      args,
      timeoutMs: 60000,
      lockKey: 'stock-ai-scheduler',
      requiredArtifacts: ['outputs/scheduler_status.json'],
    });

    if (!execResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Scheduler script failed to execute.',
          status: execResult.status,
          exitCode: execResult.exitCode,
        },
        { status: 502 }
      );
    }

    // Read back updated status
    const stockAiDir = getStockAiDir();
    const statusFile = path.join(stockAiDir, 'outputs', 'scheduler_status.json');
    let status: any = null;
    if (fs.existsSync(statusFile)) {
      try {
        status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      } catch {}
    }

    return NextResponse.json({
      success: true,
      action,
      message:
        action === 'install-task'
          ? 'Scheduled task registered for Mon-Fri 15:45 IST'
          : action === 'uninstall-task'
          ? 'Scheduled task removed'
          : 'Automated EOD pipeline executed successfully',
      durationMs: execResult.durationMs,
      data: status,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to process scheduler action' },
      { status: 500 }
    );
  }
}
