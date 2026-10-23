import { NextRequest, NextResponse } from 'next/server';
import { optimizePortfolio, type OptimizerInput } from '../../../../lib/portfolio-optimizer';

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

    if (
      typeof body.portfolioValue !== 'number' ||
      typeof body.riskBudgetPct !== 'number' ||
      !Array.isArray(body.rankedSetups)
    ) {
      return NextResponse.json(
        { error: 'Invalid optimizer input: portfolioValue (number), riskBudgetPct (number), and rankedSetups (array) are required' },
        { status: 400 }
      );
    }

    const input: OptimizerInput = {
      rankedSetups: body.rankedSetups,
      portfolioValue: body.portfolioValue,
      riskBudgetPct: body.riskBudgetPct,
      currentPositions: Array.isArray(body.currentPositions) ? body.currentPositions : undefined,
      sectorExposures: Array.isArray(body.sectorExposures) ? body.sectorExposures : [],
      themeExposures: Array.isArray(body.themeExposures) ? body.themeExposures : [],
      enableStagedEntries: Boolean(body.enableStagedEntries),
    };

    const plan = optimizePortfolio(input);
    return NextResponse.json(plan);
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
