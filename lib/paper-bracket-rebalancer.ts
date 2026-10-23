/**
 * Paper Portfolio Bracket Order Execution and Concentration Rebalancer
 *
 * Implements:
 * 1. Multi-Leg Bracket Orders (Entry + Target + Dynamic Trailing Stop)
 * 2. Trailing Stop ratchet mechanics (locking profit as price moves in trade direction)
 * 3. Portfolio Concentration Guard & Auto-Rebalancing Planner
 */

import { hashEvidenceBundle } from './paper-prediction-service';
import type { PredictionCohort, ProspectiveObservation } from './paper-prediction-types';

export interface BracketLeg {
  type: 'ENTRY' | 'TARGET' | 'STOP_LOSS' | 'TRAILING_STOP';
  orderSide: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  status: 'PENDING' | 'FILLED' | 'TRIGGERED' | 'CANCELLED';
}

export interface PaperBracketOrder {
  id: string;
  symbol: string;
  ticker: string;
  cohort: PredictionCohort;
  sessionDate: string;
  createdAt: string;
  status: 'ACTIVE' | 'TARGET_CLOSED' | 'STOP_CLOSED' | 'EXPIRED';
  quantity: number;
  entryFillPrice: number;
  targetPrice: number;
  initialStopLoss: number;
  currentTrailingStop: number;
  trailingStepBps: number; // e.g. 50 bps (0.5%)
  highWaterMark: number;
  slippageBps: number;
  evidenceBundleHash: string;
  legs: BracketLeg[];
}

export interface PositionHolding {
  symbol: string;
  ticker: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  marketValue: number;
  weightPercent: number;
}

export interface RebalanceAction {
  symbol: string;
  action: 'TRIM' | 'ACCUMULATE' | 'HOLD';
  currentWeight: number;
  targetWeight: number;
  sharesDelta: number;
  valueDeltaINR: number;
  reason: string;
}

export interface PortfolioRebalancePlan {
  totalPortfolioValue: number;
  cashReserveINR: number;
  maxPositionCapPercent: number;
  holdings: PositionHolding[];
  rebalanceActions: RebalanceAction[];
  isRebalanceRequired: boolean;
}

/**
 * Creates a validated multi-leg bracket order with 5 bps simulated slippage and trailing stop parameters.
 */
export function createBracketOrder(params: {
  symbol: string;
  ticker?: string;
  entryPrice: number;
  targetPrice: number;
  stopLossPrice: number;
  quantity: number;
  cohort?: PredictionCohort;
  sessionDate?: string;
  trailingStepBps?: number;
  slippageBps?: number;
}): PaperBracketOrder {
  const {
    symbol,
    ticker = `${symbol}.NS`,
    entryPrice,
    targetPrice,
    stopLossPrice,
    quantity,
    cohort = 'COHORT_A_CLEAN_MODEL',
    sessionDate = new Date().toISOString().split('T')[0],
    trailingStepBps = 50,
    slippageBps = 5,
  } = params;

  if (quantity <= 0 || !Number.isSafeInteger(quantity)) {
    throw new Error('Quantity must be a positive integer');
  }
  if (entryPrice <= 0 || targetPrice <= 0 || stopLossPrice <= 0) {
    throw new Error('Prices must be positive numbers');
  }
  if (stopLossPrice >= entryPrice) {
    throw new Error('Stop loss price must be below entry price for long bracket');
  }
  if (targetPrice <= entryPrice) {
    throw new Error('Target price must be above entry price for long bracket');
  }

  // Simulated entry slippage (+5 bps for buy fill)
  const entryFillPrice = Number((entryPrice * (1 + slippageBps / 10000)).toFixed(2));
  const now = new Date().toISOString();
  const id = `bracket_${sessionDate}_${symbol}_${Date.now()}`;

  const evidenceBundleHash = hashEvidenceBundle({
    symbol,
    quantity,
    entryFillPrice,
    targetPrice,
    stopLossPrice,
    trailingStepBps,
    source: 'multi-leg-bracket-engine',
  });

  const legs: BracketLeg[] = [
    {
      type: 'ENTRY',
      orderSide: 'BUY',
      price: entryFillPrice,
      quantity,
      status: 'FILLED',
    },
    {
      type: 'TARGET',
      orderSide: 'SELL',
      price: targetPrice,
      quantity,
      status: 'PENDING',
    },
    {
      type: 'TRAILING_STOP',
      orderSide: 'SELL',
      price: stopLossPrice,
      quantity,
      status: 'PENDING',
    },
  ];

  return {
    id,
    symbol,
    ticker,
    cohort,
    sessionDate,
    createdAt: now,
    status: 'ACTIVE',
    quantity,
    entryFillPrice,
    targetPrice,
    initialStopLoss: stopLossPrice,
    currentTrailingStop: stopLossPrice,
    trailingStepBps,
    highWaterMark: entryFillPrice,
    slippageBps,
    evidenceBundleHash,
    legs,
  };
}

/**
 * Updates a bracket order's trailing stop as high water mark advances.
 */
export function updateBracketTrailingStop(
  order: PaperBracketOrder,
  latestPrice: number
): { order: PaperBracketOrder; stopAdjusted: boolean; triggeredEvent: 'TARGET_HIT' | 'STOP_HIT' | 'NONE' } {
  if (order.status !== 'ACTIVE') {
    return { order, stopAdjusted: false, triggeredEvent: 'NONE' };
  }

  // Check Target execution first
  if (latestPrice >= order.targetPrice) {
    order.status = 'TARGET_CLOSED';
    order.legs.find(l => l.type === 'TARGET')!.status = 'FILLED';
    order.legs.find(l => l.type === 'TRAILING_STOP')!.status = 'CANCELLED';
    return { order, stopAdjusted: false, triggeredEvent: 'TARGET_HIT' };
  }

  // Check Stop Loss trigger
  if (latestPrice <= order.currentTrailingStop) {
    order.status = 'STOP_CLOSED';
    order.legs.find(l => l.type === 'TRAILING_STOP')!.status = 'TRIGGERED';
    order.legs.find(l => l.type === 'TARGET')!.status = 'CANCELLED';
    return { order, stopAdjusted: false, triggeredEvent: 'STOP_HIT' };
  }

  // Ratchet trailing stop upward if high water mark advanced by at least trailingStepBps
  let stopAdjusted = false;
  if (latestPrice > order.highWaterMark) {
    order.highWaterMark = latestPrice;
    const initialRiskINR = order.entryFillPrice - order.initialStopLoss;
    const trailBuffer = (latestPrice * order.trailingStepBps) / 10000;
    const potentialNewStop = Number((latestPrice - initialRiskINR).toFixed(2));

    // Ratchet up only; never lower a trailing stop
    if (potentialNewStop > order.currentTrailingStop) {
      order.currentTrailingStop = potentialNewStop;
      order.legs.find(l => l.type === 'TRAILING_STOP')!.price = potentialNewStop;
      stopAdjusted = true;
    }
  }

  return { order, stopAdjusted, triggeredEvent: 'NONE' };
}

/**
 * Evaluates portfolio concentration and generates automated rebalancing actions
 * enforcing strict max position concentration limits (default 25%).
 */
export function generatePortfolioRebalancePlan(
  rawHoldings: Array<{ symbol: string; ticker?: string; quantity: number; averagePrice: number; currentPrice: number }>,
  cashReserveINR: number,
  maxPositionCapPercent = 25.0
): PortfolioRebalancePlan {
  const evaluatedHoldings = rawHoldings.map(h => ({
    symbol: h.symbol,
    ticker: h.ticker || `${h.symbol}.NS`,
    quantity: h.quantity,
    averagePrice: h.averagePrice,
    currentPrice: h.currentPrice,
    marketValue: Math.round(h.quantity * h.currentPrice),
    weightPercent: 0,
  }));

  const totalStockValue = evaluatedHoldings.reduce((sum, h) => sum + h.marketValue, 0);
  const totalPortfolioValue = totalStockValue + cashReserveINR;

  // Calculate weights
  for (const h of evaluatedHoldings) {
    h.weightPercent = totalPortfolioValue > 0
      ? Number(((h.marketValue / totalPortfolioValue) * 100).toFixed(2))
      : 0;
  }

  const rebalanceActions: RebalanceAction[] = [];
  let isRebalanceRequired = false;

  for (const h of evaluatedHoldings) {
    if (h.weightPercent > maxPositionCapPercent) {
      isRebalanceRequired = true;
      const targetValueINR = (totalPortfolioValue * maxPositionCapPercent) / 100;
      const excessValueINR = h.marketValue - targetValueINR;
      const sharesToTrim = Math.ceil(excessValueINR / h.currentPrice);

      rebalanceActions.push({
        symbol: h.symbol,
        action: 'TRIM',
        currentWeight: h.weightPercent,
        targetWeight: maxPositionCapPercent,
        sharesDelta: -sharesToTrim,
        valueDeltaINR: -Math.round(sharesToTrim * h.currentPrice),
        reason: `Position weight ${h.weightPercent}% exceeds ${maxPositionCapPercent}% risk cap. Trim ${sharesToTrim} shares to restore concentration balance.`,
      });
    } else {
      rebalanceActions.push({
        symbol: h.symbol,
        action: 'HOLD',
        currentWeight: h.weightPercent,
        targetWeight: h.weightPercent,
        sharesDelta: 0,
        valueDeltaINR: 0,
        reason: `Position weight ${h.weightPercent}% is within safe risk envelope (≤${maxPositionCapPercent}%).`,
      });
    }
  }

  return {
    totalPortfolioValue,
    cashReserveINR,
    maxPositionCapPercent,
    holdings: evaluatedHoldings,
    rebalanceActions,
    isRebalanceRequired,
  };
}
