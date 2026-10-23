/**
 * Indian Equity Statutory Tax, Brokerage & Friction Calculator (NSE/BSE Delivery & Swing)
 *
 * Implements exact Indian market regulatory levies per SEBI & NSE schedules:
 * 1. Securities Transaction Tax (STT): 0.1% on Buy + 0.1% on Sell (0.20% total on turnover for delivery)
 * 2. Brokerage: Standard discount broker (default ₹20/executed order, or ₹0 for zero-brokerage delivery plans)
 * 3. Exchange Transaction Charges (NSE): 0.00325% on turnover
 * 4. SEBI Turnover Charges: 0.0001% (₹10 per Crore)
 * 5. Stamp Duty: 0.015% on Buy turnover
 * 6. GST: 18% on (Brokerage + Exchange Fees + SEBI charges)
 * 7. Depository Participant (DP) Charges: Flat ₹13.50 + 18% GST = ₹15.93 per company on sell
 * 8. Execution Slippage: Real-world bid-ask spread (default 20 bps for mid/small-caps)
 */

export interface IndianFrictionInput {
  entryPrice: number;
  exitPrice: number;
  quantity?: number;
  positionValueINR?: number;
  brokeragePerOrderINR?: number;
  slippagePct?: number;
  includeDpCharges?: boolean;
}

export interface IndianFrictionBreakdown {
  quantity: number;
  turnoverBuyINR: number;
  turnoverSellINR: number;
  totalTurnoverINR: number;
  sttINR: number;
  brokerageINR: number;
  exchangeFeesINR: number;
  sebiChargesINR: number;
  stampDutyINR: number;
  gstINR: number;
  dpChargesINR: number;
  slippageINR: number;
  totalStatutoryTaxesINR: number;
  totalFrictionINR: number;
  totalFrictionPct: number;
  grossReturnPct: number;
  netReturnPct: number;
  grossProfitINR: number;
  netProfitINR: number;
}

export const STATUTORY_RATES = {
  STT_DELIVERY_BUY_PCT: 0.001,      // 0.10%
  STT_DELIVERY_SELL_PCT: 0.001,     // 0.10%
  NSE_TRANSACTION_PCT: 0.0000325,   // 0.00325%
  SEBI_TURNOVER_PCT: 0.000001,      // 0.0001% (₹10 per crore)
  STAMP_DUTY_BUY_PCT: 0.00015,      // 0.015% on buy
  GST_RATE_PCT: 0.18,               // 18%
  DP_CHARGE_FLAT_INR: 15.93,        // ₹13.50 + 18% GST = ₹15.93 per scrip on sell
  DEFAULT_SLIPPAGE_PCT: 0.0020,     // 0.20% (20 bps)
  DEFAULT_BROKERAGE_PER_ORDER_INR: 20, // Discount broker standard (Zerodha/Angel One)
  DEFAULT_POSITION_VALUE_INR: 50_000,
};

/**
 * Calculates exact rupee and percentage friction for an Indian equity delivery trade.
 */
export function calculateIndianEquityFriction(input: IndianFrictionInput): IndianFrictionBreakdown {
  const entryPrice = Math.max(0.01, input.entryPrice);
  const exitPrice = Math.max(0.01, input.exitPrice);

  let quantity = input.quantity;
  if (!quantity || quantity <= 0) {
    const positionValue = input.positionValueINR || STATUTORY_RATES.DEFAULT_POSITION_VALUE_INR;
    quantity = Math.max(1, Math.floor(positionValue / entryPrice));
  }

  const turnoverBuyINR = Math.round(quantity * entryPrice * 100) / 100;
  const turnoverSellINR = Math.round(quantity * exitPrice * 100) / 100;
  const totalTurnoverINR = Math.round((turnoverBuyINR + turnoverSellINR) * 100) / 100;

  // 1. Securities Transaction Tax (STT) - 0.1% on buy and sell for delivery
  const sttBuy = Math.round(turnoverBuyINR * STATUTORY_RATES.STT_DELIVERY_BUY_PCT);
  const sttSell = Math.round(turnoverSellINR * STATUTORY_RATES.STT_DELIVERY_SELL_PCT);
  const sttINR = sttBuy + sttSell;

  // 2. Brokerage (Buy order + Sell order)
  const brokeragePerOrder = input.brokeragePerOrderINR !== undefined
    ? input.brokeragePerOrderINR
    : STATUTORY_RATES.DEFAULT_BROKERAGE_PER_ORDER_INR;
  const brokerageINR = Math.round(brokeragePerOrder * 2 * 100) / 100;

  // 3. Exchange Transaction Charges
  const exchangeFeesINR = Math.round(totalTurnoverINR * STATUTORY_RATES.NSE_TRANSACTION_PCT * 100) / 100;

  // 4. SEBI Turnover Charges
  const sebiChargesINR = Math.round(totalTurnoverINR * STATUTORY_RATES.SEBI_TURNOVER_PCT * 100) / 100;

  // 5. Stamp Duty (Buy side only)
  const stampDutyINR = Math.round(turnoverBuyINR * STATUTORY_RATES.STAMP_DUTY_BUY_PCT * 100) / 100;

  // 6. GST (18% on Brokerage + Exchange fees + SEBI)
  const gstTaxableBase = brokerageINR + exchangeFeesINR + sebiChargesINR;
  const gstINR = Math.round(gstTaxableBase * STATUTORY_RATES.GST_RATE_PCT * 100) / 100;

  // 7. DP Charges (Flat per scrip on sell side)
  const includeDp = input.includeDpCharges !== false;
  const dpChargesINR = includeDp ? STATUTORY_RATES.DP_CHARGE_FLAT_INR : 0;

  // 8. Execution Slippage
  const slippagePct = input.slippagePct !== undefined
    ? input.slippagePct
    : STATUTORY_RATES.DEFAULT_SLIPPAGE_PCT;
  const slippageINR = Math.round(totalTurnoverINR * slippagePct * 100) / 100;

  const totalStatutoryTaxesINR = Math.round((sttINR + exchangeFeesINR + sebiChargesINR + stampDutyINR + gstINR + dpChargesINR) * 100) / 100;
  const totalFrictionINR = Math.round((totalStatutoryTaxesINR + brokerageINR + slippageINR) * 100) / 100;
  const totalFrictionPct = Math.round((totalFrictionINR / turnoverBuyINR) * 10000) / 100;

  const grossProfitINR = Math.round((turnoverSellINR - turnoverBuyINR) * 100) / 100;
  const netProfitINR = Math.round((grossProfitINR - totalFrictionINR) * 100) / 100;
  const grossReturnPct = Math.round(((exitPrice - entryPrice) / entryPrice) * 10000) / 100;
  const netReturnPct = Math.round((grossReturnPct - totalFrictionPct) * 100) / 100;

  return {
    quantity,
    turnoverBuyINR,
    turnoverSellINR,
    totalTurnoverINR,
    sttINR,
    brokerageINR,
    exchangeFeesINR,
    sebiChargesINR,
    stampDutyINR,
    gstINR,
    dpChargesINR,
    slippageINR,
    totalStatutoryTaxesINR,
    totalFrictionINR,
    totalFrictionPct,
    grossReturnPct,
    netReturnPct,
    grossProfitINR,
    netProfitINR,
  };
}

/**
 * Calculates standard delivery friction percentage for a given position size.
 */
export function getStandardDeliveryFrictionPct(positionValueINR = STATUTORY_RATES.DEFAULT_POSITION_VALUE_INR): number {
  const result = calculateIndianEquityFriction({
    entryPrice: 100,
    exitPrice: 100,
    positionValueINR,
  });
  return result.totalFrictionPct;
}

/**
 * Calculates net mathematical expectancy and risk-to-reward ratio after Indian friction.
 */
export function calculateNetSwingExpectancy(
  targetPct: number,
  stopPct: number,
  winProbability: number,
  positionValueINR = STATUTORY_RATES.DEFAULT_POSITION_VALUE_INR,
): {
  grossExpectancyPct: number;
  netExpectancyPct: number;
  breakEvenWinRatePct: number;
  riskRewardRatio: number;
  frictionPct: number;
} {
  const friction = getStandardDeliveryFrictionPct(positionValueINR);
  // Support both decimal notation (0.10 for 10%) and percentage points (10.0 for 10%)
  const target = Math.abs(targetPct) <= 1.0 ? Math.abs(targetPct) * 100 : Math.abs(targetPct);
  const stop = Math.abs(stopPct) <= 1.0 ? Math.abs(stopPct) * 100 : Math.abs(stopPct);

  const grossWinPct = target;
  const grossLossPct = -stop;
  const netWinPct = target - friction;
  const netLossPct = -(stop + friction);

  const probWin = Math.max(0, Math.min(1, winProbability));
  const probLoss = 1 - probWin;

  const grossExpectancyPct = Math.round((probWin * grossWinPct + probLoss * grossLossPct) * 100) / 100;
  const netExpectancyPct = Math.round((probWin * netWinPct + probLoss * netLossPct) * 100) / 100;

  // Break-even formula: P * NetWin - (1 - P) * NetLoss = 0 => P = NetLoss / (NetWin + NetLoss)
  const breakEvenWinRatePct = Math.round((Math.abs(netLossPct) / (netWinPct + Math.abs(netLossPct))) * 1000) / 10;
  const riskRewardRatio = Math.round((target / stop) * 100) / 100;

  return {
    grossExpectancyPct,
    netExpectancyPct,
    breakEvenWinRatePct,
    riskRewardRatio,
    frictionPct: Math.round(friction * 100) / 100,
  };
}
