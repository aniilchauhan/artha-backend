/** Manual INR scenarios. Contract availability, margins and execution are not inferred. */
export interface FuturesScenario {
  side: 'long' | 'short'; entry: number; exit: number; lotSize: number; lots: number; costs: number;
  marginPerLot: number | null;
}
export interface OptionLeg { side: 'buy' | 'sell'; type: 'CE' | 'PE'; strike: number; premium: number; lots: number }
export interface OptionsScenario { lotSize: number; settlement: number; costs: number; legs: OptionLeg[] }
function amount(value: number, label: string, positive = false) {
  if (!Number.isFinite(value) || value < 0 || value > 1e9 || (positive && value === 0)) throw new Error(`${label} must be ${positive ? 'positive' : 'nonnegative'} and finite (maximum 1 billion).`);
}
function quantity(value: number, label: string, max: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${label} must be a whole number from 1 to ${max}.`);
}
export function calculateFutures(input: FuturesScenario) {
  if (!['long', 'short'].includes(input.side)) throw new Error('Choose a futures direction.');
  amount(input.entry, 'Entry', true); amount(input.exit, 'Exit'); amount(input.costs, 'Costs');
  quantity(input.lotSize, 'Lot size', 1000000); quantity(input.lots, 'Lots', 10000);
  if (input.marginPerLot !== null) amount(input.marginPerLot, 'Margin per lot', true);
  const units = input.lotSize * input.lots;
  const sign = input.side === 'long' ? 1 : -1;
  const gross = sign * (input.exit - input.entry) * units;
  return { units, notional: input.entry * units, gross, net: gross - input.costs,
    breakEven: input.entry + sign * input.costs / units >= 0 ? input.entry + sign * input.costs / units : null,
    maximumLoss: input.side === 'short' ? null : input.entry * units + input.costs,
    suppliedMargin: input.marginPerLot === null ? null : input.marginPerLot * input.lots,
    onePointPnl: sign * units };
}

export function calculateOptions(input: OptionsScenario) {
  quantity(input.lotSize, 'Lot size', 1000000); amount(input.settlement, 'Expiry underlying price'); amount(input.costs, 'Costs');
  if (!Array.isArray(input.legs) || input.legs.length < 1 || input.legs.length > 4) throw new Error('Use between one and four option legs.');
  for (const leg of input.legs) {
    if (!['buy', 'sell'].includes(leg.side) || !['CE', 'PE'].includes(leg.type)) throw new Error('Invalid option leg.');
    quantity(leg.lots, 'Leg lots', 10000); amount(leg.strike, 'Strike', true); amount(leg.premium, 'Premium');
  }
  const netPremium = input.legs.reduce((n, leg) => n + (leg.side === 'buy' ? 1 : -1) * leg.premium * leg.lots * input.lotSize, 0);
  const payoff = (price: number) => input.legs.reduce((n, leg) => {
    const intrinsic = leg.type === 'CE' ? Math.max(0, price - leg.strike) : Math.max(0, leg.strike - price);
    return n + (leg.side === 'buy' ? 1 : -1) * intrinsic * leg.lots * input.lotSize;
  }, -netPremium - input.costs);
  const knots = [...new Set([0, ...input.legs.map(l => l.strike)])].sort((a, b) => a - b);
  const rightSlope = input.legs.filter(l => l.type === 'CE').reduce((n, l) => n + (l.side === 'buy' ? 1 : -1) * l.lots * input.lotSize, 0);
  const values = knots.map(payoff);
  const roots: number[] = [], zeroRanges: Array<[number, number | null]> = [];
  const epsilon = 1e-7;
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i], b = knots[i + 1], fa = values[i], fb = values[i + 1];
    if (Math.abs(fa) < epsilon && Math.abs(fb) < epsilon) zeroRanges.push([a, b]);
    else {
      if (Math.abs(fa) < epsilon) roots.push(a);
      if (fa * fb < 0) roots.push(a - fa * (b - a) / (fb - fa));
      if (Math.abs(fb) < epsilon) roots.push(b);
    }
  }
  const last = knots.at(-1)!, lastPayoff = values.at(-1)!;
  if (rightSlope === 0 && Math.abs(lastPayoff) < epsilon) zeroRanges.push([last, null]);
  else if (rightSlope !== 0) {
    const root = last - lastPayoff / rightSlope;
    if (root >= last) roots.push(root);
  }
  const breakEvens = [...new Set(roots.map(n => Math.round(n * 1e8) / 1e8))].filter(n => !zeroRanges.some(([a, b]) => n >= a && (b === null || n <= b)));
  const end = Math.max(last * 1.3, input.settlement * 1.1, 1);
  const points = [...new Set([...knots, input.settlement, ...Array.from({ length: 41 }, (_, i) => end * i / 40)])].sort((a, b) => a - b).map(price => ({ price, pnl: payoff(price) }));
  return { netPremium, net: payoff(input.settlement), breakEvens, zeroRanges,
    maximumProfit: rightSlope > 0 ? null : Math.max(0, ...values),
    maximumLoss: rightSlope < 0 ? null : Math.max(0, -Math.min(...values)),
    hasShortLeg: input.legs.some(l => l.side === 'sell'), points };
}
