import {
  LeverageDetails,
  LeverageScenario,
  OptionsRecommendation,
  ShareOpportunity,
} from './opportunity-types';

// Official NSE F&O Lot Sizes for key equities
export const NSE_LOT_SIZES: Record<string, number> = {
  'RELIANCE.NS': 250,
  'TCS.NS': 175,
  'INFY.NS': 400,
  'HDFCBANK.NS': 550,
  'ICICIBANK.NS': 700,
  'SBIN.NS': 750,
  'BHARTIARTL.NS': 475,
  'LT.NS': 175,
  'SUNPHARMA.NS': 350,
  'VEDL.NS': 2000,
  'HAL.NS': 150,
  'KOTAKBANK.NS': 400,
  'AXISBANK.NS': 625,
  'BAJFINANCE.NS': 750,
  'BAJAJFINSV.NS': 500,
  'INDUSINDBK.NS': 500,
  'WIPRO.NS': 1500,
  'HCLTECH.NS': 350,
  'TECHM.NS': 600,
  'COALINDIA.NS': 2100,
  'ADANIENT.NS': 300,
  'ADANIPORTS.NS': 400,
  'TATASTEEL.NS': 5500,
  'MARUTI.NS': 50,
  'TITAN.NS': 175,
  'DIVISLAB.NS': 100,
  'EICHERMOT.NS': 150,
  'HEROMOTOCO.NS': 150,
  'BAJAJ-AUTO.NS': 75,
  'NTPC.NS': 1500,
  'POWERGRID.NS': 1800,
  'ONGC.NS': 3850,
  'BPCL.NS': 1800,
  'CIPLA.NS': 650,
  'DRREDDY.NS': 125,
  'ASIANPAINT.NS': 200,
  'BEL.NS': 2850,
  'ULTRACEMCO.NS': 100,
  'GRASIM.NS': 250,
  'JSWSTEEL.NS': 675,
  'HINDALCO.NS': 1400,
  'TATACONSUM.NS': 900,
  'NESTLEIND.NS': 250,
  'HINDUNILVR.NS': 300,
  'ITC.NS': 1600,
  'TRENT.NS': 200,
  'SHREECEM.NS': 25,
  'APOLLOHOSP.NS': 125,
  'M&M.NS': 350,
};

export function getStrikeInterval(price: number): number {
  if (price < 100) return 2.5;
  if (price < 250) return 5.0;
  if (price < 500) return 10.0;
  if (price < 1000) return 20.0;
  if (price < 2500) return 50.0;
  if (price < 5000) return 100.0;
  if (price < 10000) return 200.0;
  return 500.0;
}

export function snapToAtmStrike(price: number): number {
  const step = getStrikeInterval(price);
  return Math.round(Math.round(price / step) * step * 10) / 10;
}

export function buildOptionsRecommendation(
  ticker: string,
  price: number,
  targetPrice: number,
  direction: 'LONG' | 'SHORT' = 'LONG',
  budget: number = 25000
): OptionsRecommendation {
  const sym = ticker.endsWith('.NS') ? ticker : `${ticker}.NS`;
  const cleanTicker = ticker.replace('.NS', '');
  const lotSize = NSE_LOT_SIZES[sym] || 500;
  const optionType = direction === 'LONG' ? 'CE' : 'PE';
  const strikePrice = snapToAtmStrike(price);

  // Approximation: ~2.5% premium for near-the-money 15-day contract
  const estPremium = Math.max(1.0, Math.round(price * 0.025 * 100) / 100);
  const underlyingMove = Math.abs(targetPrice - price);
  const delta = 0.52;
  const premiumGain = Math.round(underlyingMove * delta * 1.15 * 100) / 100;
  const targetPremium = Math.round((estPremium + premiumGain) * 100) / 100;
  const stopPremium = Math.round(estPremium * 0.72 * 100) / 100; // -28% stop

  const costPerLot = Math.round(estPremium * lotSize * 100) / 100;
  const recommendedLots = Math.max(1, Math.floor(budget / Math.max(1, costPerLot)));
  const totalInvestment = Math.round(costPerLot * recommendedLots * 100) / 100;

  const totalShares = lotSize * recommendedLots;
  const projectedProfitInr = Math.round((targetPremium - estPremium) * totalShares * 100) / 100;
  const maxRiskInr = Math.round((estPremium - stopPremium) * totalShares * 100) / 100;

  const expectedRoiPct = Math.round(((targetPremium - estPremium) / estPremium) * 1000) / 10;
  const maxRiskPct = 28.0;

  return {
    ticker,
    underlyingPrice: price,
    direction,
    optionType,
    strikePrice,
    symbolFormatted: `${cleanTicker} ${strikePrice} ${optionType}`,
    lotSize,
    recommendedLots,
    estimatedPremium: estPremium,
    targetPremium,
    stopPremium,
    costPerLot,
    totalInvestmentInr: totalInvestment,
    projectedProfitInr,
    maxRiskInr,
    expectedRoiPct,
    maxRiskPct,
    delta: 0.52,
    executionGuideline: `Buy ${recommendedLots} lot(s) of ${strikePrice} ${optionType} near ₹${estPremium}. Exit at Target ₹${targetPremium} (+${expectedRoiPct}%) or Stop ₹${stopPremium}.`,
  };
}

export function calculateLeverageScenarios(
  opp: Partial<ShareOpportunity>,
  capitalBase: number = 100000
): LeverageDetails {
  const price = opp.reference && opp.reference > 0 ? opp.reference : 1000;
  const target = opp.target && opp.target > 0 ? opp.target : price * 1.02;
  const stop = opp.stop && opp.stop > 0 ? opp.stop : price * 0.985;
  const direction: 'LONG' | 'SHORT' = opp.direction || (target >= price ? 'LONG' : 'SHORT');

  const priceMove = Math.abs(target - price);
  const stopDistance = Math.abs(price - stop);

  // Position Sizing: 25% of capital base per opportunity (e.g. ₹25,000 on ₹1 Lakh)
  const allocCapital = Math.round(capitalBase * 0.25);

  // 1. CASH 1X
  const cashQty = Math.max(1, Math.floor(allocCapital / price));
  const cashProfit = Math.round(cashQty * priceMove * 100) / 100;
  const cashRisk = Math.round(cashQty * stopDistance * 100) / 100;
  const cashRoi = Math.round((cashProfit / allocCapital) * 1000) / 10;
  const cashRiskPct = Math.round((cashRisk / allocCapital) * 1000) / 10;
  const cashRR = Math.round((cashProfit / Math.max(1, cashRisk)) * 100) / 100;

  const cash1x: LeverageScenario = {
    mode: 'CASH_1X',
    modeLabel: 'Cash 1x (Delivery / CNC)',
    capitalAllocated: allocCapital,
    effectiveExposure: allocCapital,
    quantityOrLots: cashQty,
    entryPriceOrPremium: price,
    targetPriceOrPremium: target,
    stopPriceOrPremium: stop,
    expectedProfitInr: cashProfit,
    maxRiskInr: cashRisk,
    roiPct: cashRoi,
    riskPct: cashRiskPct,
    rewardRiskRatio: cashRR,
    brokerOrderType: 'CNC / Delivery',
  };

  // 2. MIS 5X (Intraday Leverage)
  const misExposure = allocCapital * 5; // e.g. ₹1,25,000 on ₹25,000 margin
  const misQty = Math.max(1, Math.floor(misExposure / price));
  const misProfit = Math.round(misQty * priceMove * 100) / 100;
  const misRisk = Math.round(misQty * stopDistance * 100) / 100;
  const misRoi = Math.round((misProfit / allocCapital) * 1000) / 10;
  const misRiskPct = Math.round((misRisk / allocCapital) * 1000) / 10;
  const misRR = Math.round((misProfit / Math.max(1, misRisk)) * 100) / 100;

  const mis5x: LeverageScenario = {
    mode: 'MIS_5X',
    modeLabel: '5x MIS Intraday Margin',
    capitalAllocated: allocCapital,
    effectiveExposure: misExposure,
    quantityOrLots: misQty,
    entryPriceOrPremium: price,
    targetPriceOrPremium: target,
    stopPriceOrPremium: stop,
    expectedProfitInr: misProfit,
    maxRiskInr: misRisk,
    roiPct: misRoi,
    riskPct: misRiskPct,
    rewardRiskRatio: misRR,
    brokerOrderType: 'MIS (5x Intraday)',
  };

  // 3. OPTIONS ATM
  const optionsRec =
    opp.optionsRecommendation ||
    buildOptionsRecommendation(opp.ticker || 'NIFTY', price, target, direction, allocCapital);

  const optionsAtm: LeverageScenario = {
    mode: 'OPTIONS_ATM',
    modeLabel: `Options Supercharged (${optionsRec.symbolFormatted})`,
    capitalAllocated: optionsRec.totalInvestmentInr,
    effectiveExposure: Math.round(optionsRec.lotSize * optionsRec.recommendedLots * price),
    quantityOrLots: optionsRec.recommendedLots,
    entryPriceOrPremium: optionsRec.estimatedPremium,
    targetPriceOrPremium: optionsRec.targetPremium,
    stopPriceOrPremium: optionsRec.stopPremium,
    expectedProfitInr: optionsRec.projectedProfitInr,
    maxRiskInr: optionsRec.maxRiskInr,
    roiPct: optionsRec.expectedRoiPct,
    riskPct: optionsRec.maxRiskPct,
    rewardRiskRatio: Math.round((optionsRec.projectedProfitInr / Math.max(1, optionsRec.maxRiskInr)) * 100) / 100,
    brokerOrderType: 'NRML / F&O',
  };

  return {
    capitalBase,
    cash1x,
    mis5x,
    optionsAtm,
  };
}
