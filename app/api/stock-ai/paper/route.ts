import { NextRequest, NextResponse } from 'next/server';
import { getArtifactProvenance } from '../../../../lib/artifact-provenance';
import { getPortfolioAllocation, getPaperTradingSignals } from '../../../../lib/stock-ai-service';
import { requireAdmin, verifyRequestOrigin } from '../../../../lib/auth-guard';
import { executePythonScript } from '../../../../lib/python-runner';

export const dynamic = 'force-dynamic';

const VALID_SIZING_MODES = new Set(['VOLATILITY_PARITY', 'EQUAL_WEIGHT', 'KELLY_OPTIMAL']);

export async function GET() {
  try {
    const portfolioProvenance = getArtifactProvenance('paper_trading/portfolio_allocation.json');
    const signalsProvenance = getArtifactProvenance('paper_trading/paper_signals.json');
    if (portfolioProvenance.status !== 'verified' || signalsProvenance.status !== 'verified') {
      return NextResponse.json(
        { success: false, error: 'Paper trading artifacts are not verified for serving', provenance: { portfolio: portfolioProvenance, signals: signalsProvenance } },
        { status: 503 }
      );
    }
    const portfolio = getPortfolioAllocation();
    const signals = getPaperTradingSignals();

    return NextResponse.json({
      success: true,
      data: {
        portfolio,
        signals,
      },
      provenance: { portfolio: portfolioProvenance, signals: signalsProvenance },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch paper trading data' },
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
    const capitalBase = Number(body.capitalBase) || 1000000.0;
    const riskPct = Number(body.riskPct) || 1.0;
    const sizingMode = String(body.sizingMode || 'VOLATILITY_PARITY').toUpperCase();
    const maxPositions = Number(body.maxPositions) || 5;

    // Parameter bounds validation
    if (capitalBase < 1000 || capitalBase > 1000000000) {
      return NextResponse.json(
        { success: false, error: 'capitalBase must be between 1,000 and 1,000,000,000 INR.' },
        { status: 400 }
      );
    }

    if (riskPct < 0.1 || riskPct > 10.0) {
      return NextResponse.json(
        { success: false, error: 'riskPct must be between 0.1% and 10.0%.' },
        { status: 400 }
      );
    }

    if (!VALID_SIZING_MODES.has(sizingMode)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid sizingMode: "${sizingMode}". Supported: ${Array.from(VALID_SIZING_MODES).join(', ')}`,
        },
        { status: 400 }
      );
    }

    if (maxPositions < 1 || maxPositions > 50) {
      return NextResponse.json(
        { success: false, error: 'maxPositions must be an integer between 1 and 50.' },
        { status: 400 }
      );
    }

    const args = [
      '--capital', String(capitalBase),
      '--risk-pct', String(riskPct),
      '--mode', sizingMode,
      '--max-positions', String(maxPositions),
    ];

    const execResult = await executePythonScript({
      scriptName: 'paper_trading.py',
      args,
      timeoutMs: 30000,
      lockKey: 'stock-ai-paper',
      requiredArtifacts: [
        'outputs/paper_trading/portfolio_allocation.json',
        'outputs/paper_trading/paper_signals.json',
      ],
    });

    if (!execResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Paper trading simulation failed to execute.',
          status: execResult.status,
          exitCode: execResult.exitCode,
        },
        { status: 502 }
      );
    }

    const portfolio = getPortfolioAllocation();
    const signals = getPaperTradingSignals();
    const portfolioProvenance = getArtifactProvenance('paper_trading/portfolio_allocation.json');
    const signalsProvenance = getArtifactProvenance('paper_trading/paper_signals.json');
    if (portfolioProvenance.status !== 'verified' || signalsProvenance.status !== 'verified') {
      return NextResponse.json(
        { success: false, error: 'Generated paper trading artifacts are not verified for serving', provenance: { portfolio: portfolioProvenance, signals: signalsProvenance } },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Paper trading rebalance completed with mode ${sizingMode}`,
      durationMs: execResult.durationMs,
      freshness: {
        isFresh: execResult.artifactsFresh,
        metadata: execResult.artifactMetadata,
      },
      data: {
        portfolio,
        signals,
      },
      provenance: { portfolio: portfolioProvenance, signals: signalsProvenance },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to execute paper trading simulation' },
      { status: 500 }
    );
  }
}
