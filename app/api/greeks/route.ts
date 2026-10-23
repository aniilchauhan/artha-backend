import { NextRequest, NextResponse } from 'next/server';
import { calculateGreeks, buildGreeksChain, solveImpliedVolatility, computeGreeksSurface } from '../../../lib/option-greeks';
import { getNSEStrikeStep } from '../../../lib/option-chain';

export const dynamic = 'force-dynamic';

/**
 * POST /api/greeks
 *
 * Computes Option Greeks using the Black-Scholes model.
 *
 * Actions:
 * - "single": Calculate Greeks for a single option leg
 * - "chain": Build full Greeks chain across strikes centered on ATM
 * - "solve-iv": Reverse-solve implied volatility from market premium
 * - "surface": Generate 2D price sensitivity surface (spot × IV grid)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action as string;

    switch (action) {
      case 'single': {
        const result = calculateGreeks({
          spotPrice: body.spotPrice,
          strikePrice: body.strikePrice,
          daysToExpiry: body.daysToExpiry,
          impliedVolatilityPercent: body.impliedVolatilityPercent,
          riskFreeRatePercent: body.riskFreeRatePercent,
          optionType: body.optionType,
        });
        return NextResponse.json({ success: true, greeks: result });
      }

      case 'chain': {
        const spotPrice = body.spotPrice;
        const strikeStep = body.strikeStep ?? getNSEStrikeStep(spotPrice);
        const result = buildGreeksChain({
          symbol: body.symbol ?? 'UNKNOWN',
          spotPrice,
          daysToExpiry: body.daysToExpiry,
          impliedVolatilityPercent: body.impliedVolatilityPercent,
          riskFreeRatePercent: body.riskFreeRatePercent,
          strikeStep,
          strikeRange: body.strikeRange,
        });
        return NextResponse.json({ success: true, chain: result });
      }

      case 'solve-iv': {
        const iv = solveImpliedVolatility(
          body.marketPrice,
          body.spotPrice,
          body.strikePrice,
          body.daysToExpiry,
          body.optionType,
          body.riskFreeRatePercent
        );
        return NextResponse.json({
          success: iv !== null,
          impliedVolatilityPercent: iv,
          message: iv !== null
            ? `Solved IV: ${iv}% for ${body.optionType} at strike ₹${body.strikePrice}`
            : 'IV solver did not converge',
        });
      }

      case 'surface': {
        const surface = computeGreeksSurface({
          strikePrice: body.strikePrice,
          daysToExpiry: body.daysToExpiry,
          optionType: body.optionType,
          riskFreeRatePercent: body.riskFreeRatePercent,
          spotRange: body.spotRange,
          ivRange: body.ivRange,
          spotSteps: body.spotSteps,
          ivSteps: body.ivSteps,
        });
        return NextResponse.json({ success: true, surface, points: surface.length });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}. Use: single, chain, solve-iv, or surface.` },
          { status: 400 }
        );
    }
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Greeks calculation failed' },
      { status: 400 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    service: 'option-greeks',
    actions: ['single', 'chain', 'solve-iv', 'surface'],
    description: 'Black-Scholes Option Greeks Calculator (Delta, Gamma, Theta, Vega, Rho)',
    timestamp: new Date().toISOString(),
  });
}
