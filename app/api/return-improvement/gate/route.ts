import { NextRequest, NextResponse } from 'next/server';
import { evaluateQualityGate, type SetupInput } from '../../../../lib/quality-gate';
import { computePositionSize } from '../../../../lib/risk-model';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid request body: JSON expected' },
        { status: 400 }
      );
    }

    const setup: SetupInput = body.setup ?? body;

    if (
      !setup ||
      typeof setup.id !== 'string' ||
      typeof setup.symbol !== 'string' ||
      typeof setup.entryPrice !== 'number'
    ) {
      return NextResponse.json(
        { error: 'Invalid setup input: id, symbol, and entryPrice are required' },
        { status: 400 }
      );
    }

    const gateResult = evaluateQualityGate(setup);

    let sizingResult = null;
    if (gateResult.passed) {
      sizingResult = computePositionSize({
        sizingPolicy: body.sizingPolicy === 'risk-budget-v1' ? 'risk-budget-v1' : 'legacy-allocation',
        riskScenario: body.riskScenario,
        setup,
        portfolioValue: typeof body.portfolioValue === 'number' ? body.portfolioValue : 1_000_000,
        sectorExposures: Array.isArray(body.sectorExposures) ? body.sectorExposures : [],
        themeExposures: Array.isArray(body.themeExposures) ? body.themeExposures : [],
        sector: typeof body.sector === 'string' ? body.sector : 'General',
        theme: typeof body.theme === 'string' ? body.theme : 'General',
      });
    }

    return NextResponse.json({
      gateResult,
      sizingResult,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
