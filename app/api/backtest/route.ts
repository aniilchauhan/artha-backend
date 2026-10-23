import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface HistoricalPrice {
  date: string;
  price: number;
}

interface SimulatedTrade {
  id: string;
  type: 'BUY' | 'SELL';
  date: string;
  price: number;
  shares: number;
  cashRemaining: number;
  portfolioValue: number;
  profitOrLoss?: number;
}

interface EquityPoint {
  date: string;
  value: number;
  buyAndHoldValue: number;
}

const MAX_HISTORY_LENGTH = 5000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateHistory(history: unknown): history is HistoricalPrice[] {
  if (!Array.isArray(history) || history.length === 0 || history.length > MAX_HISTORY_LENGTH) {
    return false;
  }

  let previousDate = '';
  return history.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const row = item as Partial<HistoricalPrice>;
    if (typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return false;
    if (!isFiniteNumber(row.price) || row.price <= 0 || row.date <= previousDate) return false;
    previousDate = row.date;
    return true;
  });
}

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= min && value <= max;
}

function isBoundedNumber(value: unknown, min: number, max: number): value is number {
  return isFiniteNumber(value) && value >= min && value <= max;
}

interface BacktestResults {
  equityHistory: EquityPoint[];
  trades: SimulatedTrade[];
  totalReturnPercent: number;
  buyAndHoldReturnPercent: number;
  finalPortfolioValue: number;
  finalBuyAndHoldValue: number;
  totalTradesCount: number;
  winRate: number;
  maxDrawdown: number;
  capitalInvested: number;
}

function getSMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function getEMA(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  if (prices.length < period) {
    return prices.reduce((a, b) => a + b, 0) / prices.length;
  }
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function getRSI(prices: number[], period = 14): number {
  if (prices.length <= period) return 50;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function getBollingerBands(prices: number[], period = 20, numStdDev = 2) {
  if (prices.length < period) {
    const price = prices[prices.length - 1] || 0;
    return { upper: price, middle: price, lower: price };
  }
  const slice = prices.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((acc, val) => acc + Math.pow(val - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    upper: middle + numStdDev * stdDev,
    middle: middle,
    lower: middle - numStdDev * stdDev
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      history,
      capital,
      strategyType,
      startDateStr,
      endDateStr,
      // Strategy params
      fastPeriod = 5,
      slowPeriod = 15,
      maType = 'SMA',
      rsiPeriod = 14,
      rsiOversold = 30,
      rsiOverbought = 70,
      bbPeriod = 20,
      bbStdDev = 2,
    } = body;

    // Validate inputs
    if (!validateHistory(history)) {
      return NextResponse.json({ error: 'History must contain 1-5000 chronological rows with valid positive prices' }, { status: 400 });
    }
    if (!isBoundedNumber(capital, 0.01, 1_000_000_000)) {
      return NextResponse.json({ error: 'Capital must be a positive number' }, { status: 400 });
    }
    if (!['MA_CROSSOVER', 'RSI_OS', 'BOLLINGER_REVERSION'].includes(strategyType)) {
      return NextResponse.json({ error: 'Invalid strategyType' }, { status: 400 });
    }
    if (!isBoundedInteger(fastPeriod, 2, 500) || !isBoundedInteger(slowPeriod, 2, 500) || fastPeriod >= slowPeriod) {
      return NextResponse.json({ error: 'Moving-average periods must be integers from 2-500 with fastPeriod below slowPeriod' }, { status: 400 });
    }
    if (!isBoundedInteger(rsiPeriod, 2, 100) || !isBoundedNumber(rsiOversold, 1, 49) || !isBoundedNumber(rsiOverbought, 51, 99) || rsiOversold >= rsiOverbought) {
      return NextResponse.json({ error: 'Invalid RSI parameters' }, { status: 400 });
    }
    if (!isBoundedInteger(bbPeriod, 2, 500) || !isBoundedNumber(bbStdDev, 0.1, 10)) {
      return NextResponse.json({ error: 'Invalid Bollinger Band parameters' }, { status: 400 });
    }

    const startIndex = history.findIndex(h => h.date === startDateStr);
    const endIndex = history.findIndex(h => h.date === endDateStr);

    if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
      return NextResponse.json({ error: 'Invalid date range boundaries' }, { status: 400 });
    }

    let cash = capital;
    let shares = 0;
    let lastBuyPrice = 0;
    const trades: SimulatedTrade[] = [];
    const equityHistory: EquityPoint[] = [];

    // Calculate initial Buy & Hold parameters
    const initialPrice = history[startIndex].price;
    const buyAndHoldShares = Math.floor(capital / initialPrice);
    const buyAndHoldCash = capital - buyAndHoldShares * initialPrice;

    for (let i = startIndex; i <= endIndex; i++) {
      const today = history[i];
      const todayPrice = today.price;
      
      const historyUpToToday = history.slice(0, i + 1);
      const pricesUpToToday = historyUpToToday.map(h => h.price);

      let signal: 'BUY' | 'SELL' | null = null;

      // Apply strategy logic
      if (strategyType === 'MA_CROSSOVER') {
        if (pricesUpToToday.length > 2) {
          const pricesYesterday = pricesUpToToday.slice(0, -1);
          
          const fastToday = maType === 'EMA' ? getEMA(pricesUpToToday, fastPeriod) : getSMA(pricesUpToToday, fastPeriod);
          const slowToday = maType === 'EMA' ? getEMA(pricesUpToToday, slowPeriod) : getSMA(pricesUpToToday, slowPeriod);
          
          const fastYesterday = maType === 'EMA' ? getEMA(pricesYesterday, fastPeriod) : getSMA(pricesYesterday, fastPeriod);
          const slowYesterday = maType === 'EMA' ? getEMA(pricesYesterday, slowPeriod) : getSMA(pricesYesterday, slowPeriod);

          if (fastYesterday <= slowYesterday && fastToday > slowToday) {
            signal = 'BUY';
          } else if (fastYesterday >= slowYesterday && fastToday < slowToday) {
            signal = 'SELL';
          }
        }
      } else if (strategyType === 'RSI_OS') {
        if (pricesUpToToday.length > rsiPeriod) {
          const rsiToday = getRSI(pricesUpToToday, rsiPeriod);
          const rsiYesterday = getRSI(pricesUpToToday.slice(0, -1), rsiPeriod);

          if (rsiYesterday < rsiOversold && rsiToday >= rsiOversold) {
            signal = 'BUY';
          } else if (rsiYesterday > rsiOverbought && rsiToday <= rsiOverbought) {
            signal = 'SELL';
          }
        }
      } else if (strategyType === 'BOLLINGER_REVERSION') {
        if (pricesUpToToday.length >= bbPeriod) {
          const { upper, lower } = getBollingerBands(pricesUpToToday, bbPeriod, bbStdDev);
          if (todayPrice <= lower) {
            signal = 'BUY';
          } else if (todayPrice >= upper) {
            signal = 'SELL';
          }
        }
      }

      // Actioning signal
      if (signal === 'BUY' && cash >= todayPrice && shares === 0) {
        const sharesToBuy = Math.floor(cash / todayPrice);
        if (sharesToBuy > 0) {
          shares = sharesToBuy;
          const cost = shares * todayPrice;
          cash = Number((cash - cost).toFixed(2));
          lastBuyPrice = todayPrice;
          trades.push({
            id: Math.random().toString(36).substring(2, 9),
            type: 'BUY',
            date: today.date,
            price: todayPrice,
            shares,
            cashRemaining: cash,
            portfolioValue: Number((cash + shares * todayPrice).toFixed(2))
          });
        }
      } else if (signal === 'SELL' && shares > 0) {
        const revenue = shares * todayPrice;
        const profitOrLoss = Number((revenue - shares * lastBuyPrice).toFixed(2));
        cash = Number((cash + revenue).toFixed(2));
        trades.push({
          id: Math.random().toString(36).substring(2, 9),
          type: 'SELL',
          date: today.date,
          price: todayPrice,
          shares,
          cashRemaining: cash,
          portfolioValue: cash,
          profitOrLoss
        });
        shares = 0;
      }

      const currentPortfolioValue = Number((cash + shares * todayPrice).toFixed(2));
      const currentBuyAndHoldValue = Number((buyAndHoldCash + buyAndHoldShares * todayPrice).toFixed(2));

      equityHistory.push({
        date: today.date,
        value: currentPortfolioValue,
        buyAndHoldValue: currentBuyAndHoldValue
      });
    }

    const endPrice = history[endIndex].price;
    const finalPortfolioValue = Number((cash + shares * endPrice).toFixed(2));
    const finalBuyAndHoldValue = Number((buyAndHoldCash + buyAndHoldShares * endPrice).toFixed(2));

    const totalReturnPercent = Number((((finalPortfolioValue - capital) / capital) * 100).toFixed(2));
    const buyAndHoldReturnPercent = Number((((finalBuyAndHoldValue - capital) / capital) * 100).toFixed(2));

    const closedTrades = trades.filter(t => t.type === 'SELL');
    const profitableCount = closedTrades.filter(t => (t.profitOrLoss || 0) > 0).length;
    const winRate = closedTrades.length > 0 
      ? Number(((profitableCount / closedTrades.length) * 100).toFixed(2)) 
      : 0;

    let peak = capital;
    let maxDrawdown = 0;
    for (const pt of equityHistory) {
      if (pt.value > peak) peak = pt.value;
      const dd = ((peak - pt.value) / peak) * 100;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    const results: BacktestResults = {
      equityHistory,
      trades,
      totalReturnPercent,
      buyAndHoldReturnPercent,
      finalPortfolioValue,
      finalBuyAndHoldValue,
      totalTradesCount: trades.length,
      winRate,
      maxDrawdown: Number(maxDrawdown.toFixed(2)),
      capitalInvested: capital
    };

    return NextResponse.json(results);
  } catch (error: any) {
    console.error('Error executing backtest:', error);
    return NextResponse.json({ error: error?.message || 'Server error running backtest' }, { status: 500 });
  }
}
