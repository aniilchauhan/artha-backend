import { DetailedSuggestionResult } from './stock-data';

export interface StockReturnMetrics {
  targetPrice: number;
  projectedReturnPercent: number; // e.g. 7.5 (meaning +7.5%)
  stopLossPrice: number;
  downsideRiskPercent: number;    // e.g. 2.5 (meaning -2.5%)
  riskRewardRatio: number;        // e.g. 3.0 (meaning 3.0:1)
  isBreakout: boolean;
  isHighAlpha: boolean;
  expectedGainRupees: number;     // e.g. ₹3,750 for configured capital
  setupType: 'Breakout Surge' | 'Momentum Swing' | 'Value Reversal' | 'Growth Trend';
}

export function calculateReturnMetrics(
  stock: {
    currentPrice: number;
    changePercent?: number;
    volume?: number;
    history?: { price: number; close?: number }[];
  },
  detailed?: DetailedSuggestionResult | null,
  capital = 50000
): StockReturnMetrics {
  const currentPrice = Math.max(0.01, stock.currentPrice || 100);
  const changePercent = stock.changePercent ?? 0;
  const volume = stock.volume ?? 100000;
  const score = detailed?.score ?? 0;
  const suggestion = detailed?.suggestion ?? 'HOLD';

  // Base upside percentage calculation derived from technical momentum & score
  let baseUpsidePercent = 4.0;
  if (suggestion === 'BUY') {
    baseUpsidePercent = 5.5 + Math.min(8.5, Math.max(0, (score / 100) * 8.0));
  } else if (suggestion === 'SELL') {
    baseUpsidePercent = 2.0;
  } else {
    baseUpsidePercent = 3.5 + Math.min(3.0, Math.max(0, (score / 100) * 4.0));
  }

  // Factor in Bollinger Band channel headroom if upper band exceeds current price
  if (detailed?.bollingerBands && detailed.bollingerBands.upperBand > currentPrice * 1.02) {
    const bbHeadroom = ((detailed.bollingerBands.upperBand - currentPrice) / currentPrice) * 100;
    baseUpsidePercent = Math.max(baseUpsidePercent, Math.min(18.0, bbHeadroom * 0.95));
  }

  // Active breakout boost for volume and positive price expansion
  const isBreakout = changePercent >= 1.8 || (volume >= 500000 && changePercent > 0.8);
  if (isBreakout) {
    baseUpsidePercent += 1.8;
  }

  const projectedReturnPercent = Number(Math.min(25.0, Math.max(1.8, baseUpsidePercent)).toFixed(1));
  const targetPrice = Number((currentPrice * (1 + projectedReturnPercent / 100)).toFixed(2));

  // Risk / Stop Loss floor calculation ensuring disciplined risk-reward
  const stopLossFactor = Math.max(0.012, Math.min(0.05, (projectedReturnPercent / 100) / 2.6));
  const stopLossPrice = Number((currentPrice * (1 - stopLossFactor)).toFixed(2));
  const downsideRiskPercent = Number((((currentPrice - stopLossPrice) / currentPrice) * 100).toFixed(1));

  const riskRewardRatio = Number((projectedReturnPercent / Math.max(0.5, downsideRiskPercent)).toFixed(1));
  const isHighAlpha = projectedReturnPercent >= 5.0 && riskRewardRatio >= 2.0;

  const expectedGainRupees = Math.round(capital * (projectedReturnPercent / 100));

  let setupType: 'Breakout Surge' | 'Momentum Swing' | 'Value Reversal' | 'Growth Trend' = 'Growth Trend';
  if (isBreakout) {
    setupType = 'Breakout Surge';
  } else if (detailed?.macd?.signal === 'BULLISH' || changePercent > 1.2) {
    setupType = 'Momentum Swing';
  } else if (detailed?.bollingerBands?.signal === 'BUY' || (detailed?.score ?? 0) > 40) {
    setupType = 'Value Reversal';
  }

  return {
    targetPrice,
    projectedReturnPercent,
    stopLossPrice,
    downsideRiskPercent,
    riskRewardRatio,
    isBreakout,
    isHighAlpha,
    expectedGainRupees,
    setupType,
  };
}
