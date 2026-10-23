/**
 * AX-19, AX-20, AX-21: Accountable Paper Position State Machine & Event Ledger
 *
 * Implements:
 * 1. Finite State Machine for Paper Positions:
 *    pending -> filled -> closed
 *            -> expired (missed entry != losing trade)
 *            -> cancelled
 * 2. Event-Sourced Ledger Architecture:
 *    Every portfolio balance change is derived from immutable sequenced events.
 * 3. Portfolio Constraints:
 *    ₹50,000 base, 3-slot cap, whole shares, 1% risk budget, no synthetic recommendations.
 * 4. Provenance:
 *    Every order links to immutable DecisionSignal ID, creation time, fill evidence, and exit reason.
 */

import type { DecisionSignal } from './signal-schema';
import {createHash} from 'node:crypto';

export type PaperOrderStatus =
  | 'pending'
  | 'filled'
  | 'cancelled'
  | 'expired'
  | 'closed';

export type PaperExitReason =
  | 'target'
  | 'invalidation_stop'
  | 'gap_stop'
  | 'gap_target'
  | 'trailing_stop'
  | 'breakeven_stop'
  | 'time_expiry'
  | 'manual_review';

export interface PaperEvent {
  id: string; // e.g. "evt_ord_TRENT_fill_1728345600"
  type:
    | 'ORDER_SUBMITTED'
    | 'ORDER_FILLED'
    | 'ORDER_CANCELLED'
    | 'ORDER_EXPIRED'
    | 'POSITION_EXITED';
  timestamp: string; // ISO 8601
  orderId: string;
  symbol: string;
  payload: any;
}

export interface PaperOrder {
  id: string; // Deterministic order ID: e.g. "pord_sig_AX_STRAT_01_v1_0_TRENT_2026-10-08_r1"
  signalId: string;
  signalHash: string;
  strategyVersion?: string;
  planHash?: string;
  signalSnapshot?: DecisionSignal;
  symbol: string;
  companyName: string;
  status: PaperOrderStatus;
  submittedAt: string;
  sessionValidityEnd: string;
  intendedTrigger: number;
  invalidationStop: number;
  targetPrice: number;
  maxOpeningGap: number;
  maxHoldSessions: number;

  // Sizing
  requestedShares: number;
  allocatedSlotCapital: number;

  // Execution Details (when filled)
  fillDate?: string;
  fillPrice?: number;
  filledShares?: number;
  fillNotional?: number;
  entryChargesInr?: number;

  // Exit Details (when closed)
  exitDate?: string;
  exitPrice?: number;
  exitReason?: PaperExitReason;
  exitChargesInr?: number;
  grossPnl?: number;
  netPnl?: number;
  returnPct?: number;
  holdingSessions?: number;
  lastEvaluatedSession?: string;

  // Dynamic Trailing / Breakeven Stop
  ratchetedStop?: number;
  ratchetStatus?: 'initial' | 'breakeven_protected' | 'trailing_profit_locked';

  // Cancellation / Expiry Details
  cancellationReason?: string;
}

export interface PaperPortfolioState {
  initialCapital: number;
  cash: number;
  totalHoldingsValue: number;
  totalEquity: number;
  maxPositions: number;
  orders: Record<string, PaperOrder>;
  activePositions: Record<string, PaperOrder>;
  closedTrades: PaperOrder[];
  events: PaperEvent[];
  processedEventIds: Set<string>;
  marketMarks?: Record<string, { price: number; asOf: string }>;
}

export interface PaperPortfolioSummary {
  cash: number;
  holdingsValue: number;
  totalEquity: number;
  activeCount: number;
  pendingCount: number;
  closedCount: number;
  expiredCount: number; // Missed entries
  winRatePct: number;
  realizedPnl: number;
  cashReconciliationDelta: number; // Invariant: must be 0.00
}

/**
 * Creates a clean, empty Paper Portfolio State.
 */
export function createPaperPortfolio(initialCapital = 50000, maxPositions = 3): PaperPortfolioState {
  return {
    initialCapital,
    cash: initialCapital,
    totalHoldingsValue: 0,
    totalEquity: initialCapital,
    maxPositions,
    orders: {},
    activePositions: {},
    closedTrades: [],
    events: [],
    processedEventIds: new Set<string>(),
  };
}

/**
 * Submits a new paper order from an immutable DecisionSignal.
 */
export function submitPaperOrder(
  portfolio: PaperPortfolioState,
  signal: DecisionSignal,
  now = signal.issuedAt || new Date().toISOString(),
  sourceSignal: DecisionSignal = signal
): { success: boolean; orderId: string; error?: string } {
  const orderId = `pord_${signal.id}`;
  if (signal.signalType !== 'ACTIONABLE_PAPER_SIGNAL' || !Number.isFinite(Date.parse(signal.validUntil)) || Date.parse(now) > Date.parse(signal.validUntil) ||
      signal.sizing.wholeShares < 1 || !Number.isInteger(signal.sizing.wholeShares)) return { success:false, orderId, error:'Signal is not a valid, unexpired paper plan.' };
  if (portfolio.activePositions[signal.symbol] || Object.values(portfolio.orders).some(o => o.symbol === signal.symbol && o.status === 'pending')) return {success:false,orderId,error:'A position or pending order already exists for this stock.'};

  if (portfolio.orders[orderId]) {
    return { success: false, orderId, error: 'Order already exists for this signal ID' };
  }

  // Active positions plus pending orders cannot exceed max slots
  const activeCount = Object.keys(portfolio.activePositions).length;
  const pendingCount = Object.values(portfolio.orders).filter((o) => o.status === 'pending').length;

  if (activeCount + pendingCount >= portfolio.maxPositions) {
    return {
      success: false,
      orderId,
      error: `Portfolio position cap (${portfolio.maxPositions}) reached. Cannot submit new paper order.`,
    };
  }

  const order: PaperOrder = {
    id: orderId,
    signalId: signal.id,
    signalHash: sourceSignal.immutableHash,
    strategyVersion: signal.strategyVersion,
    planHash: createHash('sha256').update(JSON.stringify({sourceHash:sourceSignal.immutableHash,strategyVersion:signal.strategyVersion,conditions:signal.conditions,sizing:signal.sizing,validUntil:signal.validUntil,submittedAt:now})).digest('hex'),
    signalSnapshot: structuredClone(sourceSignal),
    symbol: signal.symbol,
    companyName: signal.companyName,
    status: 'pending',
    submittedAt: now,
    sessionValidityEnd: signal.validUntil,
    intendedTrigger: signal.conditions.entryTrigger,
    invalidationStop: signal.conditions.invalidationStop,
    targetPrice: signal.conditions.targetScenario,
    maxOpeningGap: signal.conditions.maxOpeningGap,
    maxHoldSessions: signal.conditions.reviewSessions,
    requestedShares: signal.sizing.wholeShares,
    allocatedSlotCapital: signal.sizing.slotCapital,
  };

  const event: PaperEvent = {
    id: `evt_sub_${orderId}`,
    type: 'ORDER_SUBMITTED',
    timestamp: now,
    orderId,
    symbol: signal.symbol,
    payload: { order },
  };

  applyEvent(portfolio, event);
  return { success: true, orderId };
}

/**
 * Simulates daily market session matching for paper orders and active positions.
 */
export function evaluateSessionMarket(
  portfolio: PaperPortfolioState,
  marketQuote: {
    symbol: string;
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    isUpperCircuit?: boolean;
    isLowerCircuit?: boolean;
  },
  slippagePct = 0.0005,
  deliveryFeePct = 0.0025,
  dpFeeInr = 15.34
): PaperEvent[] {
  const generatedEvents: PaperEvent[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(marketQuote.date) || ![marketQuote.open,marketQuote.high,marketQuote.low,marketQuote.close].every(n => Number.isFinite(n) && n > 0) ||
      marketQuote.high < Math.max(marketQuote.open,marketQuote.close,marketQuote.low) || marketQuote.low > Math.min(marketQuote.open,marketQuote.close) || !Number.isFinite(marketQuote.volume)) throw new Error('Invalid paper market session.');
  portfolio.marketMarks ??= {};
  portfolio.marketMarks[marketQuote.symbol] = {price:marketQuote.close,asOf:marketQuote.date};
  recalculatePortfolioSummary(portfolio);

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Evaluate PENDING orders for entry fills
  // ───────────────────────────────────────────────────────────────────────────
  for (const order of Object.values(portfolio.orders)) {
    if (order.status !== 'pending' || order.symbol !== marketQuote.symbol) continue;
    if (marketQuote.date <= order.submittedAt.slice(0,10)) continue;

    // Check expiry
    if (new Date(marketQuote.date) > new Date(order.sessionValidityEnd)) {
      const expEvent: PaperEvent = {
        id: `evt_exp_${order.id}_${marketQuote.date}`,
        type: 'ORDER_EXPIRED',
        timestamp: `${marketQuote.date}T15:30:00.000Z`,
        orderId: order.id,
        symbol: order.symbol,
        payload: { reason: 'Validity window elapsed without trigger breach.' },
      };
      applyEvent(portfolio, expEvent);
      generatedEvents.push(expEvent);
      continue;
    }

    // Check circuit lock
    if (marketQuote.isUpperCircuit || marketQuote.isLowerCircuit || marketQuote.volume <= 0 || marketQuote.high === marketQuote.low) {
      continue; // Frozen, cannot fill
    }

    // Check if open exceeded max gap-up
    if (marketQuote.open > order.maxOpeningGap) {
      const cancelEvent: PaperEvent = {
        id: `evt_cnl_${order.id}_${marketQuote.date}`,
        type: 'ORDER_CANCELLED',
        timestamp: `${marketQuote.date}T09:15:00.000Z`,
        orderId: order.id,
        symbol: order.symbol,
        payload: {
          reason: `Opening price ₹${marketQuote.open} exceeded max tolerance ₹${order.maxOpeningGap}.`,
        },
      };
      applyEvent(portfolio, cancelEvent);
      generatedEvents.push(cancelEvent);
      continue;
    }

    // Check trigger breach
    if (marketQuote.high >= order.intendedTrigger) {
      const baseFill = Math.max(marketQuote.open, order.intendedTrigger);
      const fillPrice = Number((baseFill * (1 + slippagePct)).toFixed(2));

      // Sizing bounded by current cash
      const availableCash = portfolio.cash;
      const maxShares = Math.floor(Math.min(availableCash,order.allocatedSlotCapital) / (fillPrice * 1.001));
      const filledShares = Math.min(order.requestedShares, maxShares);

      if (filledShares <= 0) {
        const cancelEvent: PaperEvent = {
          id: `evt_cnl_nocash_${order.id}_${marketQuote.date}`,
          type: 'ORDER_CANCELLED',
          timestamp: `${marketQuote.date}T09:15:00.000Z`,
          orderId: order.id,
          symbol: order.symbol,
          payload: { reason: 'Insufficient available cash in portfolio for minimum 1 whole share.' },
        };
        applyEvent(portfolio, cancelEvent);
        generatedEvents.push(cancelEvent);
        continue;
      }

      const notional = Number((filledShares * fillPrice).toFixed(2));
      const entryCharges = Number((notional * 0.001).toFixed(2)); // 0.1% entry fee

      const fillEvent: PaperEvent = {
        id: `evt_fill_${order.id}_${marketQuote.date}`,
        type: 'ORDER_FILLED',
        timestamp: `${marketQuote.date}T09:15:00.000Z`,
        orderId: order.id,
        symbol: order.symbol,
        payload: {
          fillDate: marketQuote.date,
          fillPrice,
          filledShares,
          fillNotional: notional,
          entryChargesInr: entryCharges,
        },
      };

      applyEvent(portfolio, fillEvent);
      generatedEvents.push(fillEvent);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Evaluate ACTIVE positions for exits
  // ───────────────────────────────────────────────────────────────────────────
  const active = portfolio.activePositions[marketQuote.symbol];
  if (active) {
    if (active.lastEvaluatedSession !== marketQuote.date) {
      active.holdingSessions = (active.holdingSessions ?? 0) + 1;
      active.lastEvaluatedSession = marketQuote.date;
    }
    if (marketQuote.isLowerCircuit || marketQuote.volume <= 0 || marketQuote.high === marketQuote.low) {
      // Locked at lower circuit freeze: cannot exit
      return generatedEvents;
    }

    // A. Overnight gap conditions at OPEN
    if (active.fillDate !== marketQuote.date && marketQuote.open <= active.invalidationStop) {
      const exitPrice = Number((marketQuote.open * (1 - slippagePct)).toFixed(2));
      const stopReason: PaperExitReason =
        active.ratchetStatus === 'trailing_profit_locked'
          ? 'trailing_stop'
          : active.ratchetStatus === 'breakeven_protected'
          ? 'breakeven_stop'
          : 'gap_stop';
      const exitEvent = createExitEvent(active, marketQuote.date, exitPrice, stopReason, deliveryFeePct, dpFeeInr);
      applyEvent(portfolio, exitEvent);
      generatedEvents.push(exitEvent);
      return generatedEvents;
    }

    if (active.fillDate !== marketQuote.date && marketQuote.open >= active.targetPrice) {
      const exitPrice = Number((marketQuote.open * (1 - slippagePct)).toFixed(2));
      const exitEvent = createExitEvent(active, marketQuote.date, exitPrice, 'gap_target', deliveryFeePct, dpFeeInr);
      applyEvent(portfolio, exitEvent);
      generatedEvents.push(exitEvent);
      return generatedEvents;
    }

    // B. Intrabar conditions
    const hitTarget = marketQuote.high >= active.targetPrice;
    const hitStop = marketQuote.low <= active.invalidationStop;
    const currentStopReason: PaperExitReason =
      active.ratchetStatus === 'trailing_profit_locked'
        ? 'trailing_stop'
        : active.ratchetStatus === 'breakeven_protected'
        ? 'breakeven_stop'
        : 'invalidation_stop';

    if (hitTarget && hitStop) {
      // Conservative Stop-first rule
      const exitPrice = Number((active.invalidationStop * (1 - slippagePct)).toFixed(2));
      const exitEvent = createExitEvent(active, marketQuote.date, exitPrice, currentStopReason, deliveryFeePct, dpFeeInr);
      applyEvent(portfolio, exitEvent);
      generatedEvents.push(exitEvent);
      return generatedEvents;
    }

    if (hitStop) {
      const exitPrice = Number((active.invalidationStop * (1 - slippagePct)).toFixed(2));
      const exitEvent = createExitEvent(active, marketQuote.date, exitPrice, currentStopReason, deliveryFeePct, dpFeeInr);
      applyEvent(portfolio, exitEvent);
      generatedEvents.push(exitEvent);
      return generatedEvents;
    }

    if (hitTarget) {
      const exitPrice = Number((active.targetPrice * (1 - slippagePct)).toFixed(2));
      const exitEvent = createExitEvent(active, marketQuote.date, exitPrice, 'target', deliveryFeePct, dpFeeInr);
      applyEvent(portfolio, exitEvent);
      generatedEvents.push(exitEvent);
      return generatedEvents;
    }

    if ((active.holdingSessions ?? 0) >= active.maxHoldSessions) {
      const event = createExitEvent(active, marketQuote.date, Number((marketQuote.close * (1 - slippagePct)).toFixed(2)), 'time_expiry', deliveryFeePct, dpFeeInr);
      applyEvent(portfolio, event);
      generatedEvents.push(event);
      return generatedEvents;
    }

    // C. Dynamic Statutory Breakeven Ratchet and Trailing Stops (tightened strictly for subsequent sessions)
    const fill = active.fillPrice ?? active.intendedTrigger;
    if (fill > 0) {
      if (marketQuote.high >= fill * 1.07) {
        const profitLock = Number((fill * 1.045).toFixed(2));
        if (active.invalidationStop < profitLock) {
          active.invalidationStop = profitLock;
          active.ratchetedStop = profitLock;
          active.ratchetStatus = 'trailing_profit_locked';
        }
      } else if (marketQuote.high >= fill * 1.04) {
        const breakeven = Number((fill * 1.008).toFixed(2));
        if (active.invalidationStop < breakeven) {
          active.invalidationStop = breakeven;
          active.ratchetedStop = breakeven;
          active.ratchetStatus = 'breakeven_protected';
        }
      }
    }
  }

  return generatedEvents;
}

function createExitEvent(
  order: PaperOrder,
  exitDate: string,
  exitPrice: number,
  exitReason: PaperExitReason,
  deliveryFeePct: number,
  dpFeeInr: number
): PaperEvent {
  const notional = order.fillNotional ?? 0;
  const shares = order.filledShares ?? 0;
  const charges = Number((notional * deliveryFeePct + dpFeeInr).toFixed(2));
  const grossProceeds = Number((shares * exitPrice).toFixed(2));
  const proceeds = Number((grossProceeds - charges).toFixed(2));
  const entryCharges = order.entryChargesInr ?? 0;
  const grossPnl = Number((grossProceeds - notional).toFixed(2));
  const netPnl = Number((proceeds - notional - entryCharges).toFixed(2));

  return {
    id: `evt_exit_${order.id}_${exitDate}`,
    type: 'POSITION_EXITED',
    timestamp: `${exitDate}T15:30:00.000Z`,
    orderId: order.id,
    symbol: order.symbol,
    payload: {
      exitDate,
      exitPrice,
      exitReason,
      exitChargesInr: charges,
      grossPnl,
      netPnl,
      returnPct: Number(((netPnl / notional) * 100).toFixed(2)),
      proceeds,
    },
  };
}

/**
 * Applies an event idempotently to the portfolio state machine.
 */
export function applyEvent(portfolio: PaperPortfolioState, event: PaperEvent): boolean {
  if (!event || !event.id) {
    return false;
  }
  // Idempotency check: duplicate event IDs cannot re-apply
  if (portfolio.processedEventIds.has(event.id)) {
    return false;
  }

  portfolio.processedEventIds.add(event.id);
  portfolio.events.push(structuredClone(event));

  switch (event.type) {
    case 'ORDER_SUBMITTED': {
      const order = structuredClone(event.payload.order) as PaperOrder;
      portfolio.orders[order.id] = order;
      break;
    }

    case 'ORDER_FILLED': {
      const order = portfolio.orders[event.orderId];
      if (order && order.status === 'pending') {
        order.status = 'filled';
        order.fillDate = event.payload.fillDate;
        order.fillPrice = event.payload.fillPrice;
        order.filledShares = event.payload.filledShares;
        order.fillNotional = event.payload.fillNotional;
        order.entryChargesInr = event.payload.entryChargesInr;

        portfolio.cash = Number((portfolio.cash - order.fillNotional! - order.entryChargesInr!).toFixed(2));
        portfolio.activePositions[order.symbol] = order;
      }
      break;
    }

    case 'ORDER_CANCELLED': {
      const order = portfolio.orders[event.orderId];
      if (order && order.status === 'pending') {
        order.status = 'cancelled';
        order.cancellationReason = event.payload.reason;
      }
      break;
    }

    case 'ORDER_EXPIRED': {
      const order = portfolio.orders[event.orderId];
      if (order && order.status === 'pending') {
        order.status = 'expired';
        order.cancellationReason = event.payload.reason;
      }
      break;
    }

    case 'POSITION_EXITED': {
      const order = portfolio.orders[event.orderId];
      if (order && order.status === 'filled') {
        order.status = 'closed';
        order.exitDate = event.payload.exitDate;
        order.exitPrice = event.payload.exitPrice;
        order.exitReason = event.payload.exitReason;
        order.exitChargesInr = event.payload.exitChargesInr;
        order.grossPnl = event.payload.grossPnl;
        order.netPnl = event.payload.netPnl;
        order.returnPct = event.payload.returnPct;

        portfolio.cash = Number((portfolio.cash + event.payload.proceeds).toFixed(2));
        delete portfolio.activePositions[order.symbol];
        portfolio.closedTrades.push(order);
      }
      break;
    }
  }

  // Update totals
  recalculatePortfolioSummary(portfolio);
  return true;
}

/**
 * Recomputes portfolio cash reconciliation and summaries.
 */
export function recalculatePortfolioSummary(portfolio: PaperPortfolioState): PaperPortfolioSummary {
  let holdingsValue = 0;
  for (const pos of Object.values(portfolio.activePositions)) {
    holdingsValue += (pos.filledShares ?? 0) * (portfolio.marketMarks?.[pos.symbol]?.price ?? pos.fillPrice ?? 0);
  }
  portfolio.totalHoldingsValue = Number(holdingsValue.toFixed(2));
  portfolio.totalEquity = Number((portfolio.cash + portfolio.totalHoldingsValue).toFixed(2));

  const closedCount = portfolio.closedTrades.length;
  const wins = portfolio.closedTrades.filter((t) => (t.netPnl ?? 0) > 0).length;
  const realizedPnl = portfolio.closedTrades.reduce((sum, t) => sum + (t.netPnl ?? 0), 0);

  // Exact cash reconciliation invariant:
  // Current Cash == Initial Capital + Realized PnL - Active Positions Cost - Total Entry Charges
  const totalCostActive = Object.values(portfolio.activePositions).reduce(
    (sum, p) => sum + (p.fillNotional ?? 0) + (p.entryChargesInr ?? 0),
    0
  );
  const expectedCash = Number((portfolio.initialCapital + realizedPnl - totalCostActive).toFixed(2));
  const cashReconciliationDelta = Number(Math.abs(portfolio.cash - expectedCash).toFixed(2));

  return {
    cash: portfolio.cash,
    holdingsValue: portfolio.totalHoldingsValue,
    totalEquity: portfolio.totalEquity,
    activeCount: Object.keys(portfolio.activePositions).length,
    pendingCount: Object.values(portfolio.orders).filter((o) => o.status === 'pending').length,
    closedCount,
    expiredCount: Object.values(portfolio.orders).filter((o) => o.status === 'expired').length,
    winRatePct: closedCount > 0 ? Number(((wins / closedCount) * 100).toFixed(1)) : 0,
    realizedPnl: Number(realizedPnl.toFixed(2)),
    cashReconciliationDelta,
  };
}
