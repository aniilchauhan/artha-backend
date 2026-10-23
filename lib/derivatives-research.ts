/**
 * Axion Derivatives and Options Strategy Research Engine
 * 
 * Satisfies Year 2 Backlog Epic 8:
 * "Cross-asset research and derivatives research depth — options/greeks, multi-leg spreads,
 * risk payoffs, and macro context. Evidence-backed and explainable."
 */

import { calculateGreeks, type OptionType, type GreeksResult } from './option-greeks';

export type OptionsStrategyType =
  | 'LONG_CALL'
  | 'LONG_PUT'
  | 'BULL_CALL_SPREAD'
  | 'BEAR_PUT_SPREAD'
  | 'LONG_STRADDLE'
  | 'IRON_CONDOR';

export interface OptionLeg {
  id: string;
  type: OptionType; // 'CE' | 'PE'
  action: 'BUY' | 'SELL';
  strike: number;
  premium: number;
  quantity: number;
}

export interface PayoffCurvePoint {
  spot: number;
  payoff: number; // In ₹
  returnPct: number;
}

export interface OptionsStrategyAnalysis {
  strategyName: string;
  spotPrice: number;
  netDebitOrCreditInr: number;
  maxProfitInr: number | 'UNLIMITED';
  maxLossInr: number | 'UNLIMITED';
  riskRewardRatio: number | 'UNLIMITED';
  breakevenPoints: number[];
  netDelta: number;
  netGamma: number;
  netTheta: number;
  netVega: number;
  payoffCurve: PayoffCurvePoint[];
}

/**
 * Calculates theoretical multi-leg options strategy payoff and composite Greeks.
 */
export function analyzeOptionsStrategy(
  spotPrice: number,
  daysToExpiry: number,
  ivPercent: number,
  legs: OptionLeg[]
): OptionsStrategyAnalysis {
  if (legs.length === 0 || spotPrice <= 0) {
    throw new Error('Valid spot price and at least one option leg required.');
  }

  // 1. Calculate net premium outlay (debit vs credit)
  let netCashOutlay = 0;
  for (const leg of legs) {
    const cost = leg.premium * leg.quantity;
    netCashOutlay += leg.action === 'BUY' ? cost : -cost;
  }

  // 2. Compute composite Greeks by summing across all legs
  let netDelta = 0;
  let netGamma = 0;
  let netTheta = 0;
  let netVega = 0;

  for (const leg of legs) {
    const greeks = calculateGreeks({
      spotPrice,
      strikePrice: leg.strike,
      daysToExpiry,
      impliedVolatilityPercent: ivPercent,
      optionType: leg.type,
    });

    const direction = leg.action === 'BUY' ? 1 : -1;
    netDelta += greeks.delta * leg.quantity * direction;
    netGamma += greeks.gamma * leg.quantity * direction;
    netTheta += greeks.theta * leg.quantity * direction;
    netVega += greeks.vega * leg.quantity * direction;
  }

  // 3. Generate Payoff Curve across spot range (spot ± 15%)
  const minSpot = spotPrice * 0.85;
  const maxSpot = spotPrice * 1.15;
  const step = (maxSpot - minSpot) / 30;
  const payoffCurve: PayoffCurvePoint[] = [];

  const computePayoffAtSpot = (s: number): number => {
    let total = -netCashOutlay;
    for (const leg of legs) {
      let intrinsicAtExpiry = 0;
      if (leg.type === 'CE') {
        intrinsicAtExpiry = Math.max(0, s - leg.strike);
      } else {
        intrinsicAtExpiry = Math.max(0, leg.strike - s);
      }
      const legValue = intrinsicAtExpiry * leg.quantity;
      total += leg.action === 'BUY' ? legValue : -legValue;
    }
    return total;
  };

  for (let s = minSpot; s <= maxSpot; s += step) {
    const payoff = computePayoffAtSpot(s);
    const returnPct = netCashOutlay > 0 ? (payoff / netCashOutlay) * 100 : 0;
    payoffCurve.push({
      spot: parseFloat(s.toFixed(2)),
      payoff: parseFloat(payoff.toFixed(2)),
      returnPct: parseFloat(returnPct.toFixed(2)),
    });
  }

  // 4. Find Breakeven points where payoff crosses 0
  const breakevenPoints: number[] = [];
  for (let i = 0; i < payoffCurve.length - 1; i++) {
    const p1 = payoffCurve[i];
    const p2 = payoffCurve[i + 1];
    if ((p1.payoff <= 0 && p2.payoff >= 0) || (p1.payoff >= 0 && p2.payoff <= 0)) {
      const frac = Math.abs(p1.payoff) / (Math.abs(p1.payoff) + Math.abs(p2.payoff) || 1);
      const be = p1.spot + frac * (p2.spot - p1.spot);
      breakevenPoints.push(parseFloat(be.toFixed(2)));
    }
  }

  // 5. Max profit and loss across curve
  const payoffs = payoffCurve.map(p => p.payoff);
  const maxProfitInr = parseFloat(Math.max(...payoffs).toFixed(2));
  const maxLossInr = parseFloat(Math.min(...payoffs).toFixed(2));

  const riskRewardRatio =
    Math.abs(maxLossInr) > 0 ? parseFloat((maxProfitInr / Math.abs(maxLossInr)).toFixed(2)) : 'UNLIMITED';

  return {
    strategyName: legs.length === 2 && legs[0].action === 'BUY' && legs[1].action === 'SELL'
      ? 'BULL_CALL_SPREAD'
      : 'CUSTOM_MULTI_LEG_STRATEGY',
    spotPrice,
    netDebitOrCreditInr: parseFloat(netCashOutlay.toFixed(2)),
    maxProfitInr,
    maxLossInr,
    riskRewardRatio,
    breakevenPoints,
    netDelta: parseFloat(netDelta.toFixed(3)),
    netGamma: parseFloat(netGamma.toFixed(5)),
    netTheta: parseFloat(netTheta.toFixed(2)),
    netVega: parseFloat(netVega.toFixed(2)),
    payoffCurve,
  };
}
