/** Long-only scenario sizing. Fractions are 0..1; monetary values are INR. */
export interface PositionScenario {
  portfolioEquity: number;
  availableCash: number;
  entry: number;
  stop: number;
  riskFraction: number;
  maxAllocationFraction: number;
  // Explicit proportional estimates, not a statutory fee calculator.
  entryCostFraction: number;
  exitCostFraction: number;
  stopSlippageFraction: number;
  lotSize?: number;
  sectorRoom?: number;
  themeRoom?: number;
  aggregateRiskRoom?: number;
}
export interface PositionSize {
  version: 'risk-budget-v1';
  quantity: number;
  investment: number;
  cashRequired: number;
  plannedLoss: number;
  riskPerShare: number;
  allocationFraction: number;
  riskFraction: number;
  constraints: string[];
  capacity: 'hypothetical' | 'supplied';
}

export function sizePosition(input: PositionScenario): PositionSize {
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  const fraction = (n: unknown) => finite(n) && n >= 0 && n <= 1;
  if (!input || ![input.portfolioEquity, input.entry, input.stop].every(n => finite(n) && n > 0) ||
      input.portfolioEquity > 1e15 || input.entry > 1e12 || input.stop >= input.entry ||
      !finite(input.availableCash) || input.availableCash < 0 || input.availableCash > 1e15 ||
      ![input.riskFraction, input.maxAllocationFraction, input.entryCostFraction,
        input.exitCostFraction, input.stopSlippageFraction].every(fraction) || input.stopSlippageFraction === 1 ||
      [input.sectorRoom, input.themeRoom, input.aggregateRiskRoom].some(n => n !== undefined && (!finite(n) || n < 0 || n > 1e15))) {
    throw new Error('Invalid sizing inputs. Use finite positive capital/prices, a stop below entry, and fractions between 0 and 1.');
  }
  const lot = input.lotSize ?? 1;
  if (!Number.isSafeInteger(lot) || lot < 1) throw new Error('Lot size must be a positive integer.');
  const cashPerShare = input.entry * (1 + input.entryCostFraction);
  const proceedsAtStop = input.stop * (1 - input.stopSlippageFraction) * (1 - input.exitCostFraction);
  const riskPerShare = cashPerShare - proceedsAtStop;
  const limits: Array<[string, number]> = [
    ['risk_budget', input.portfolioEquity * input.riskFraction / riskPerShare],
    ['available_cash', input.availableCash / cashPerShare],
    ['position_allocation', input.portfolioEquity * input.maxAllocationFraction / input.entry],
  ];
  if (input.sectorRoom !== undefined) limits.push(['sector_room', input.sectorRoom / input.entry]);
  if (input.themeRoom !== undefined) limits.push(['theme_room', input.themeRoom / input.entry]);
  if (input.aggregateRiskRoom !== undefined) limits.push(['aggregate_risk', input.aggregateRiskRoom / riskPerShare]);
  const rounded = limits.map(([name, n]) => [name, Math.floor(n / lot) * lot] as const);
  const quantity = Math.min(...rounded.map(([, n]) => n));
  if (!Number.isSafeInteger(quantity) || !Number.isFinite(riskPerShare)) throw new Error('Sizing exceeds supported numeric precision.');
  return {
    version: 'risk-budget-v1', quantity, investment: quantity * input.entry,
    cashRequired: quantity * cashPerShare, plannedLoss: quantity * riskPerShare, riskPerShare,
    allocationFraction: quantity * input.entry / input.portfolioEquity,
    riskFraction: quantity * riskPerShare / input.portfolioEquity,
    constraints: rounded.filter(([, n]) => n === quantity).map(([name]) => name),
    capacity: [input.sectorRoom, input.themeRoom, input.aggregateRiskRoom].every(n => n !== undefined) ? 'supplied' : 'hypothetical',
  };
}
