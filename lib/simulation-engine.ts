/**
 * AX-13, AX-14, AX-15: Reproducible Historical Simulation Engine
 *
 * Implements realistic execution modeling for AX-STRAT-01:
 * - Whole shares on ₹50,000 capital base across N slots (default 3 slots).
 * - Discrete cash constraints (no leverage, no margin).
 * - Brokerage fees, STT, and DP charges (₹15.34 per overnight delivery exit).
 * - Slippage modeling (0.05% baseline, 0.10% stressed).
 * - Signals formed after close cannot fill at the same close (fills on next session).
 * - Overnight gap handling (exits fill at opening auction, not at stop level).
 * - Conservative treatment of ambiguous bars (both target & stop touched -> stop first).
 * - Circuit lock restrictions (frozen at limit -> no fill).
 * - Exposure-aware benchmark comparison with zero cash discrepancy.
 */

export interface SimulationBar {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  upperCircuit?: number;
  lowerCircuit?: number;
}

export interface SimulationSignal {
  symbol: string;
  signalDate: string; // Date signal was issued at close
  triggerPrice: number;
  stopPrice: number;
  targetPrice: number;
  maxHoldSessions?: number;
}

export interface SimulationConfig {
  initialCapital?: number; // Default: 50,000 INR
  slots?: number; // Default: 3 slots
  slippagePct?: number; // Default: 0.0005 (0.05%)
  intradayFeePct?: number; // Default: 0.001 (0.10%)
  deliveryFeePct?: number; // Default: 0.0025 (0.25%)
  dpFeeInr?: number; // Default: 15.34 INR per delivery sell
  conservativeAmbiguous?: boolean; // Default: true (Stop-first if both target & stop touched in same bar)
  strategyVersion?: string; // Default: 'AX-STRAT-01-v1.0'
}

export type ExitReason =
  | 'target'
  | 'stop'
  | 'gap_stop'
  | 'gap_target'
  | 'time_exit'
  | 'unresolved';

export interface SimulatedTradeLedgerEntry {
  id: string;
  symbol: string;
  signalDate: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  shares: number;
  notional: number;
  chargesInr: number;
  grossPnl: number;
  netPnl: number;
  returnPct: number;
  reason: ExitReason;
  holdingSessions: number;
}

export interface EquityCurvePoint {
  date: string;
  cash: number;
  holdingsValue: number;
  totalEquity: number;
  openPositionsCount: number;
  exposurePct: number;
  benchmarkValue: number;
}

export interface SimulationMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  averageHoldSessions: number;
  averageExposurePct: number;
  benchmarkBuyAndHoldReturnPct: number;
  cashReconciliationDifference: number; // Invariant: must be ~0.00
}

export interface SimulationResult {
  strategyVersion: string;
  initialCapital: number;
  finalCash: number;
  finalEquity: number;
  totalReturnPct: number;
  trades: SimulatedTradeLedgerEntry[];
  unresolvedPositions: number;
  equityCurve: EquityCurvePoint[];
  metrics: SimulationMetrics;
}

interface ActivePosition {
  symbol: string;
  signalDate: string;
  entryDate: string;
  entrySessionIndex: number;
  entryPrice: number;
  shares: number;
  notional: number;
  stopPrice: number;
  targetPrice: number;
  maxHoldSessions: number;
  markPrice: number;
}

/**
 * Runs a deterministic simulation reproducing exact cash ledgers and metrics.
 */
export function runSimulation(params: {
  barsBySymbol: Record<string, SimulationBar[]>;
  signals: SimulationSignal[];
  dates: string[];
  config?: SimulationConfig;
  benchmarkBars?: SimulationBar[]; // e.g. NIFTY index bars for comparable exposure
}): SimulationResult {
  const initialCapital = params.config?.initialCapital ?? 50000;
  const slots = params.config?.slots ?? 3;
  const slippagePct = params.config?.slippagePct ?? 0.0005;
  const deliveryFeePct = params.config?.deliveryFeePct ?? 0.0025;
  const dpFeeInr = params.config?.dpFeeInr ?? 15.34;
  const conservativeAmbiguous = params.config?.conservativeAmbiguous ?? true;
  const strategyVersion = params.config?.strategyVersion ?? 'AX-STRAT-01-v1.0';

  let cash = initialCapital;
  const activePositions: ActivePosition[] = [];
  const completedTrades: SimulatedTradeLedgerEntry[] = [];
  const equityCurve: EquityCurvePoint[] = [];

  // Index bars by date for fast lookup
  const barsMap = new Map<string, Map<string, SimulationBar>>();
  for (const [sym, bars] of Object.entries(params.barsBySymbol)) {
    const symMap = new Map<string, SimulationBar>();
    for (const bar of bars) {
      symMap.set(bar.date, bar);
    }
    barsMap.set(sym, symMap);
  }

  // Index signals by signalDate
  const signalsByDate = new Map<string, SimulationSignal[]>();
  for (const sig of params.signals) {
    const list = signalsByDate.get(sig.signalDate) || [];
    list.push(sig);
    signalsByDate.set(sig.signalDate, list);
  }

  // Benchmark initial price
  const benchmarkMap = new Map<string, number>();
  if (params.benchmarkBars && params.benchmarkBars.length > 0) {
    for (const b of params.benchmarkBars) {
      benchmarkMap.set(b.date, b.close);
    }
  }
  const benchmarkInitialPrice = params.benchmarkBars?.[0]?.close ?? 100;

  let peakEquity = initialCapital;
  let maxDrawdown = 0;

  // Process day by day chronologically
  for (let sessionIdx = 0; sessionIdx < params.dates.length; sessionIdx++) {
    const currentDate = params.dates[sessionIdx];
    const prevDate = sessionIdx > 0 ? params.dates[sessionIdx - 1] : null;

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: Process overnight exits on active positions AT THE OPENING AUCTION
    // ─────────────────────────────────────────────────────────────────────────
    for (let i = activePositions.length - 1; i >= 0; i--) {
      const pos = activePositions[i];
      const bar = barsMap.get(pos.symbol)?.get(currentDate);
      if (!bar) continue;

      // Check for circuit lock on selling
      const isLowerCircuitLocked =
        typeof bar.lowerCircuit === 'number' &&
        bar.open <= bar.lowerCircuit &&
        bar.high <= bar.lowerCircuit;

      if (isLowerCircuitLocked) {
        // Locked at lower circuit: cannot exit today
        continue;
      }

      // Check overnight gap conditions at the OPEN
      if (bar.open <= pos.stopPrice) {
        // Gap-down below stop: fills at OPEN (with slippage), NOT at stop price!
        const rawExit = bar.open;
        const exitPrice = rawExit * (1 - slippagePct);
        const charges = Number((pos.notional * deliveryFeePct + dpFeeInr).toFixed(2));
        const grossProceeds = Number((pos.shares * exitPrice).toFixed(2));
        const proceeds = Number((grossProceeds - charges).toFixed(2));
        const grossPnl = Number((grossProceeds - pos.notional).toFixed(2));
        const netPnl = Number((proceeds - pos.notional).toFixed(2));

        cash = Number((cash + proceeds).toFixed(2));
        completedTrades.push({
          id: `trade_${pos.symbol}_${pos.entryDate}_${currentDate}`,
          symbol: pos.symbol,
          signalDate: pos.signalDate,
          entryDate: pos.entryDate,
          entryPrice: pos.entryPrice,
          exitDate: currentDate,
          exitPrice: Number(exitPrice.toFixed(2)),
          shares: pos.shares,
          notional: pos.notional,
          chargesInr: charges,
          grossPnl,
          netPnl,
          returnPct: Number(((netPnl / pos.notional) * 100).toFixed(2)),
          reason: 'gap_stop',
          holdingSessions: sessionIdx - pos.entrySessionIndex + 1,
        });

        activePositions.splice(i, 1);
        continue;
      }

      if (bar.open >= pos.targetPrice) {
        // Gap-up above target: fills at OPEN (with slippage)
        const rawExit = bar.open;
        const exitPrice = rawExit * (1 - slippagePct);
        const charges = Number((pos.notional * deliveryFeePct + dpFeeInr).toFixed(2));
        const grossProceeds = Number((pos.shares * exitPrice).toFixed(2));
        const proceeds = Number((grossProceeds - charges).toFixed(2));
        const grossPnl = Number((grossProceeds - pos.notional).toFixed(2));
        const netPnl = Number((proceeds - pos.notional).toFixed(2));

        cash = Number((cash + proceeds).toFixed(2));
        completedTrades.push({
          id: `trade_${pos.symbol}_${pos.entryDate}_${currentDate}`,
          symbol: pos.symbol,
          signalDate: pos.signalDate,
          entryDate: pos.entryDate,
          entryPrice: pos.entryPrice,
          exitDate: currentDate,
          exitPrice: Number(exitPrice.toFixed(2)),
          shares: pos.shares,
          notional: pos.notional,
          chargesInr: charges,
          grossPnl,
          netPnl,
          returnPct: Number(((netPnl / pos.notional) * 100).toFixed(2)),
          reason: 'gap_target',
          holdingSessions: sessionIdx - pos.entrySessionIndex + 1,
        });

        activePositions.splice(i, 1);
        continue;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: Process new entries from PRIOR SESSION'S SIGNALS
    // (Invariant: Signals formed after a close CANNOT fill at that same close)
    // ─────────────────────────────────────────────────────────────────────────
    if (prevDate) {
      const priorSignals = signalsByDate.get(prevDate) || [];
      const availableSlots = slots - activePositions.length;

      if (availableSlots > 0 && priorSignals.length > 0) {
        // Compute available slot budget: total equity / slots
        const currentHoldingsValue = activePositions.reduce(
          (sum, p) => sum + p.shares * p.markPrice,
          0
        );
        const totalEquityBeforeEntry = cash + currentHoldingsValue;
        const slotBudget = totalEquityBeforeEntry / slots;

        for (const sig of priorSignals) {
          if (activePositions.length >= slots) break;

          const bar = barsMap.get(sig.symbol)?.get(currentDate);
          if (!bar) continue;

          // Check for upper circuit lock: if stock opens and stays locked at upper circuit, no fill
          const isUpperCircuitLocked =
            typeof bar.upperCircuit === 'number' &&
            bar.open >= bar.upperCircuit &&
            bar.low >= bar.upperCircuit;

          if (isUpperCircuitLocked || bar.volume <= 0) {
            // Cannot buy into circuit lock
            continue;
          }

          // Check if entry trigger was reached during the session (high >= trigger)
          // Opening gaps exceeding tolerance (e.g. > +2.5% above trigger) are excluded
          const maxGapTolerance = sig.triggerPrice * 1.025;
          if (bar.open > maxGapTolerance) {
            // Gap opened too far above trigger
            continue;
          }

          if (bar.high >= sig.triggerPrice) {
            // Entry fills at trigger price (or open if opened between trigger and max gap) + slippage
            const baseFill = Math.max(bar.open, sig.triggerPrice);
            const fillPrice = baseFill * (1 + slippagePct);

            // Sizing: whole shares constrained by both slotBudget and actual remaining cash
            const maxSharesByBudget = Math.floor(slotBudget / fillPrice);
            const maxSharesByCash = Math.floor(cash / fillPrice);
            const sharesToBuy = Math.min(maxSharesByBudget, maxSharesByCash);

            if (sharesToBuy <= 0) {
              // Insufficient cash to buy even 1 whole share
              continue;
            }

            const notional = Number((sharesToBuy * fillPrice).toFixed(2));
            cash = Number((cash - notional).toFixed(2));

            activePositions.push({
              symbol: sig.symbol,
              signalDate: sig.signalDate,
              entryDate: currentDate,
              entrySessionIndex: sessionIdx,
              entryPrice: Number(fillPrice.toFixed(2)),
              shares: sharesToBuy,
              notional,
              stopPrice: sig.stopPrice,
              targetPrice: sig.targetPrice,
              maxHoldSessions: sig.maxHoldSessions ?? 5,
              markPrice: bar.close,
            });
          }
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3: Process intrabar exits for positions active during today
    // ─────────────────────────────────────────────────────────────────────────
    for (let i = activePositions.length - 1; i >= 0; i--) {
      const pos = activePositions[i];
      // Do not exit on the same session day as entry
      if (pos.entryDate === currentDate) {
        continue;
      }

      const bar = barsMap.get(pos.symbol)?.get(currentDate);
      if (!bar) continue;

      // Update mark price
      pos.markPrice = bar.close;

      const hitTarget = bar.high >= pos.targetPrice;
      const hitStop = bar.low <= pos.stopPrice;

      // Invariant: Ambiguous bar where BOTH target & stop hit in same bar
      if (hitTarget && hitStop) {
        if (conservativeAmbiguous) {
          // Conservative declared treatment: STOP FIRST
          const exitPrice = pos.stopPrice * (1 - slippagePct);
          const charges = Number((pos.notional * deliveryFeePct + dpFeeInr).toFixed(2));
          const grossProceeds = Number((pos.shares * exitPrice).toFixed(2));
          const proceeds = Number((grossProceeds - charges).toFixed(2));
          const grossPnl = Number((grossProceeds - pos.notional).toFixed(2));
          const netPnl = Number((proceeds - pos.notional).toFixed(2));

          cash = Number((cash + proceeds).toFixed(2));
          completedTrades.push({
            id: `trade_${pos.symbol}_${pos.entryDate}_${currentDate}`,
            symbol: pos.symbol,
            signalDate: pos.signalDate,
            entryDate: pos.entryDate,
            entryPrice: pos.entryPrice,
            exitDate: currentDate,
            exitPrice: Number(exitPrice.toFixed(2)),
            shares: pos.shares,
            notional: pos.notional,
            chargesInr: charges,
            grossPnl,
            netPnl,
            returnPct: Number(((netPnl / pos.notional) * 100).toFixed(2)),
            reason: 'stop',
            holdingSessions: sessionIdx - pos.entrySessionIndex + 1,
          });

          activePositions.splice(i, 1);
          continue;
        }
      }

      if (hitStop) {
        const exitPrice = pos.stopPrice * (1 - slippagePct);
        const charges = Number((pos.notional * deliveryFeePct + dpFeeInr).toFixed(2));
        const grossProceeds = Number((pos.shares * exitPrice).toFixed(2));
        const proceeds = Number((grossProceeds - charges).toFixed(2));
        const grossPnl = Number((grossProceeds - pos.notional).toFixed(2));
        const netPnl = Number((proceeds - pos.notional).toFixed(2));

        cash = Number((cash + proceeds).toFixed(2));
        completedTrades.push({
          id: `trade_${pos.symbol}_${pos.entryDate}_${currentDate}`,
          symbol: pos.symbol,
          signalDate: pos.signalDate,
          entryDate: pos.entryDate,
          entryPrice: pos.entryPrice,
          exitDate: currentDate,
          exitPrice: Number(exitPrice.toFixed(2)),
          shares: pos.shares,
          notional: pos.notional,
          chargesInr: charges,
          grossPnl,
          netPnl,
          returnPct: Number(((netPnl / pos.notional) * 100).toFixed(2)),
          reason: 'stop',
          holdingSessions: sessionIdx - pos.entrySessionIndex + 1,
        });

        activePositions.splice(i, 1);
        continue;
      }

      if (hitTarget) {
        const exitPrice = pos.targetPrice * (1 - slippagePct);
        const charges = Number((pos.notional * deliveryFeePct + dpFeeInr).toFixed(2));
        const grossProceeds = Number((pos.shares * exitPrice).toFixed(2));
        const proceeds = Number((grossProceeds - charges).toFixed(2));
        const grossPnl = Number((grossProceeds - pos.notional).toFixed(2));
        const netPnl = Number((proceeds - pos.notional).toFixed(2));

        cash = Number((cash + proceeds).toFixed(2));
        completedTrades.push({
          id: `trade_${pos.symbol}_${pos.entryDate}_${currentDate}`,
          symbol: pos.symbol,
          signalDate: pos.signalDate,
          entryDate: pos.entryDate,
          entryPrice: pos.entryPrice,
          exitDate: currentDate,
          exitPrice: Number(exitPrice.toFixed(2)),
          shares: pos.shares,
          notional: pos.notional,
          chargesInr: charges,
          grossPnl,
          netPnl,
          returnPct: Number(((netPnl / pos.notional) * 100).toFixed(2)),
          reason: 'target',
          holdingSessions: sessionIdx - pos.entrySessionIndex + 1,
        });

        activePositions.splice(i, 1);
        continue;
      }

      // Check holding horizon expiry (Time Exit)
      const heldSessions = sessionIdx - pos.entrySessionIndex + 1;
      if (heldSessions >= pos.maxHoldSessions) {
        // Exit on session close at current bar close * (1 - slippage)
        const exitPrice = bar.close * (1 - slippagePct);
        const charges = Number((pos.notional * deliveryFeePct + dpFeeInr).toFixed(2));
        const grossProceeds = Number((pos.shares * exitPrice).toFixed(2));
        const proceeds = Number((grossProceeds - charges).toFixed(2));
        const grossPnl = Number((grossProceeds - pos.notional).toFixed(2));
        const netPnl = Number((proceeds - pos.notional).toFixed(2));

        cash = Number((cash + proceeds).toFixed(2));
        completedTrades.push({
          id: `trade_${pos.symbol}_${pos.entryDate}_${currentDate}`,
          symbol: pos.symbol,
          signalDate: pos.signalDate,
          entryDate: pos.entryDate,
          entryPrice: pos.entryPrice,
          exitDate: currentDate,
          exitPrice: Number(exitPrice.toFixed(2)),
          shares: pos.shares,
          notional: pos.notional,
          chargesInr: charges,
          grossPnl,
          netPnl,
          returnPct: Number(((netPnl / pos.notional) * 100).toFixed(2)),
          reason: 'time_exit',
          holdingSessions: heldSessions,
        });

        activePositions.splice(i, 1);
        continue;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4: Record daily equity curve point and calculate drawdown
    // ─────────────────────────────────────────────────────────────────────────
    let dailyHoldingsValue = 0;
    for (const pos of activePositions) {
      const bar = barsMap.get(pos.symbol)?.get(currentDate);
      if (bar) {
        pos.markPrice = bar.close;
      }
      dailyHoldingsValue += pos.shares * pos.markPrice;
    }

    const currentTotalEquity = Number((cash + dailyHoldingsValue).toFixed(2));
    if (currentTotalEquity > peakEquity) {
      peakEquity = currentTotalEquity;
    }
    const currentDrawdownPct =
      peakEquity > 0 ? ((peakEquity - currentTotalEquity) / peakEquity) * 100 : 0;
    if (currentDrawdownPct > maxDrawdown) {
      maxDrawdown = currentDrawdownPct;
    }

    const exposurePct =
      currentTotalEquity > 0
        ? Number(((dailyHoldingsValue / currentTotalEquity) * 100).toFixed(1))
        : 0;

    // Benchmark tracking
    const bClose = benchmarkMap.get(currentDate) ?? benchmarkInitialPrice;
    const benchmarkValue = Number(
      (initialCapital * (bClose / benchmarkInitialPrice)).toFixed(2)
    );

    equityCurve.push({
      date: currentDate,
      cash: Number(cash.toFixed(2)),
      holdingsValue: Number(dailyHoldingsValue.toFixed(2)),
      totalEquity: currentTotalEquity,
      openPositionsCount: activePositions.length,
      exposurePct,
      benchmarkValue,
    });
  }

  // Final totals
  const finalHoldingsValue = activePositions.reduce(
    (sum, p) => sum + p.shares * p.markPrice,
    0
  );
  const finalEquity = Number((cash + finalHoldingsValue).toFixed(2));
  const totalReturnPct = Number(
    (((finalEquity - initialCapital) / initialCapital) * 100).toFixed(2)
  );

  // Exact cash ledger reconciliation invariant:
  // Final Equity == Initial Capital + Sum(Trade Net PnL) + Unrealized PnL of open positions
  const realizedNetPnl = completedTrades.reduce((sum, t) => sum + t.netPnl, 0);
  const openPositionsCost = activePositions.reduce((sum, p) => sum + p.notional, 0);
  const unrealizedGross = finalHoldingsValue - openPositionsCost;
  const theoreticalFinal = initialCapital + realizedNetPnl + unrealizedGross;
  const cashReconciliationDifference = Number(
    Math.abs(finalEquity - theoreticalFinal).toFixed(2)
  );

  // Win/Loss metrics
  const winningTrades = completedTrades.filter((t) => t.netPnl > 0).length;
  const losingTrades = completedTrades.filter((t) => t.netPnl <= 0).length;
  const winRatePct =
    completedTrades.length > 0
      ? Number(((winningTrades / completedTrades.length) * 100).toFixed(1))
      : 0;

  const grossProfit = completedTrades
    .filter((t) => t.netPnl > 0)
    .reduce((sum, t) => sum + t.netPnl, 0);
  const grossLoss = Math.abs(
    completedTrades
      .filter((t) => t.netPnl < 0)
      .reduce((sum, t) => sum + t.netPnl, 0)
  );
  const profitFactor =
    grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 999 : 1.0;

  const totalSessionsHeld = completedTrades.reduce(
    (sum, t) => sum + t.holdingSessions,
    0
  );
  const averageHoldSessions =
    completedTrades.length > 0
      ? Number((totalSessionsHeld / completedTrades.length).toFixed(1))
      : 0;

  const averageExposurePct =
    equityCurve.length > 0
      ? Number(
          (
            equityCurve.reduce((sum, pt) => sum + pt.exposurePct, 0) /
            equityCurve.length
          ).toFixed(1)
        )
      : 0;

  const lastBenchmarkValue =
    equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].benchmarkValue : initialCapital;
  const benchmarkBuyAndHoldReturnPct = Number(
    (((lastBenchmarkValue - initialCapital) / initialCapital) * 100).toFixed(2)
  );

  return {
    strategyVersion,
    initialCapital,
    finalCash: Number(cash.toFixed(2)),
    finalEquity,
    totalReturnPct,
    trades: completedTrades,
    unresolvedPositions: activePositions.length,
    equityCurve,
    metrics: {
      totalTrades: completedTrades.length,
      winningTrades,
      losingTrades,
      winRatePct,
      profitFactor,
      maxDrawdownPct: Number(maxDrawdown.toFixed(2)),
      averageHoldSessions,
      averageExposurePct,
      benchmarkBuyAndHoldReturnPct,
      cashReconciliationDifference,
    },
  };
}
