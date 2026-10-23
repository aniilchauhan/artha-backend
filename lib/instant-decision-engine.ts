/**
 * Instant Decision Engine — Gemini-Powered Live Trade Signal Generator
 *
 * Analyzes real-time price data from the Live Data Hub and generates instant
 * trade decisions (BUY / SELL / HOLD / WATCH) with reasoning, confidence scores,
 * entry/exit levels, and position sizing suggestions.
 *
 * Uses Gemini 2.5 Flash for sub-second inference on structured market data.
 * Falls back to rule-based heuristics when LLM is unavailable.
 */

import { GoogleGenAI } from '@google/genai';
import { callGroqChat } from './free-ai-service';
import type { LiveDataLLMContext, LiveSnapshot } from './live-data-hub';
import { calculateGreeks } from './option-greeks';
import { getNSEStrikeStep } from './option-chain';

// ─── Types ──────────────────────────────────────────────────────────────

export type DecisionAction = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL' | 'WATCH';

export interface InstantDecision {
  symbol: string;
  action: DecisionAction;
  confidence: number; // 0-100
  reasoning: string;
  urgency: 'IMMEDIATE' | 'NEXT_5MIN' | 'SESSION_END' | 'NO_RUSH';
  entryZone: { low: number; high: number } | null;
  targetPrice: number | null;
  stopLoss: number | null;
  riskRewardRatio: number | null;
  positionSizeSuggestion: 'FULL' | 'HALF' | 'QUARTER' | 'AVOID';
  catalysts: string[];
  risks: string[];
  /** Technical signals identified */
  signals: TechnicalSignal[];
  /** Options insight if applicable */
  optionsInsight: string | null;
  generatedAt: string;
  source: 'gemini' | 'groq' | 'heuristic';
  model: string;
  latencyMs: number;
}

export interface TechnicalSignal {
  name: string;
  type: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
  description: string;
}

export interface DecisionBatch {
  decisions: InstantDecision[];
  marketContext: {
    breadthRatio: number;
    avgChangePercent: number;
    marketBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    totalSymbolsAnalyzed: number;
  };
  generatedAt: string;
  totalLatencyMs: number;
}

// ─── Decision Schema for Gemini ─────────────────────────────────────────

const DECISION_SYSTEM_PROMPT = `You are Axion's Instant Decision Engine — an expert quantitative analyst for NSE Indian equities.

ROLE: Analyze live intraday price data and generate instant, actionable trade decisions.

RULES:
1. Be decisive. Every stock gets a clear action: STRONG_BUY, BUY, HOLD, SELL, STRONG_SELL, or WATCH.
2. Confidence must reflect actual edge. 90+ only for extreme setups. 50-70 is typical.
3. Always provide a stop loss. Never suggest entry without a defined exit.
4. Risk-reward must be >= 1.5:1 for BUY signals, >= 2:1 for STRONG_BUY.
5. Consider momentum, VWAP positioning, trend streak, velocity, and intraday range.
6. Account for market breadth. Don't buy in a broad selloff unless the stock is clearly divergent.
7. Be concise. Reasoning should be 1-2 sentences. No fluff.
8. Urgency reflects how time-sensitive the signal is.
9. Position size reflects conviction: FULL (high conviction), HALF (moderate), QUARTER (speculative), AVOID (no entry).

TECHNICAL FRAMEWORK:
- Price > VWAP = bullish intraday bias
- Momentum1m > 0.1% = short-term buying pressure
- Momentum5m > 0.3% = sustained institutional accumulation  
- TrendStreak > 3 in same direction = momentum confirmed
- VelocityBps > 5 = fast-moving, consider tighter stops
- IntradayRange > 3% = volatile session, widen stops
- BreadthRatio > 0.6 = broad market participation (bullish context)
- BreadthRatio < 0.4 = risk-off environment`;

function buildDecisionSchema(): object {
  return {
    type: 'object',
    properties: {
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            symbol: { type: 'string' },
            action: { type: 'string', enum: ['STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'STRONG_SELL', 'WATCH'] },
            confidence: { type: 'number' },
            reasoning: { type: 'string' },
            urgency: { type: 'string', enum: ['IMMEDIATE', 'NEXT_5MIN', 'SESSION_END', 'NO_RUSH'] },
            entryLow: { type: 'number' },
            entryHigh: { type: 'number' },
            targetPrice: { type: 'number' },
            stopLoss: { type: 'number' },
            positionSize: { type: 'string', enum: ['FULL', 'HALF', 'QUARTER', 'AVOID'] },
            catalysts: { type: 'array', items: { type: 'string' } },
            risks: { type: 'array', items: { type: 'string' } },
          },
          required: ['symbol', 'action', 'confidence', 'reasoning', 'urgency', 'catalysts', 'risks'],
        },
      },
      marketBias: { type: 'string', enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
    },
    required: ['decisions', 'marketBias'],
  };
}

// ─── Gemini Decision Provider ───────────────────────────────────────────

async function geminiDecisionProvider(
  context: LiveDataLLMContext,
  symbols?: string[]
): Promise<DecisionBatch | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || /^(MY_|YOUR_)/.test(apiKey)) return null;

  const model = process.env.GEMINI_DECISION_MODEL || 'gemini-2.5-flash';
  const client = new GoogleGenAI({ apiKey, httpOptions: { timeout: 15_000, retryOptions: { attempts: 1 } } });

  const targetStocks = symbols
    ? context.stocks.filter(s => symbols.map(x => x.toUpperCase()).includes(s.symbol.toUpperCase()))
    : context.stocks;

  if (targetStocks.length === 0) return null;

  const prompt = `Analyze these live NSE stock prices and generate instant trade decisions.

MARKET SESSION:
- Breadth Ratio: ${context.sessionStats.breadthRatio} (${context.sessionStats.advancers} advancers / ${context.sessionStats.decliners} decliners)
- Avg Change: ${context.sessionStats.avgChangePercent}%
- Total Ticks: ${context.sessionStats.totalTicks}

LIVE STOCK DATA:
${JSON.stringify(targetStocks, null, 1)}

Generate a decision for EACH stock. Return JSON matching the schema.`;

  const start = Date.now();

  try {
    const result = await client.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: DECISION_SYSTEM_PROMPT,
        temperature: 0.15,
        responseMimeType: 'application/json',
        responseJsonSchema: buildDecisionSchema(),
        maxOutputTokens: 4096,
      },
    });

    const latencyMs = Date.now() - start;
    if (!result.text) return null;

    const parsed = JSON.parse(result.text);
    const decisions: InstantDecision[] = (parsed.decisions || []).map((d: any) => {
      const entry = d.entryLow && d.entryHigh ? { low: d.entryLow, high: d.entryHigh } : null;
      const rr = d.targetPrice && d.stopLoss && entry
        ? Math.abs((d.targetPrice - entry.high) / (entry.high - d.stopLoss))
        : null;

      // Generate technical signals from snapshot data
      const stockData = targetStocks.find(s => s.symbol === d.symbol);
      const signals = stockData ? generateTechnicalSignals(stockData) : [];

      // Options insight
      const optionsInsight = stockData ? generateOptionsInsight(stockData) : null;

      return {
        symbol: d.symbol,
        action: d.action,
        confidence: Math.min(100, Math.max(0, Math.round(d.confidence))),
        reasoning: d.reasoning || '',
        urgency: d.urgency || 'NO_RUSH',
        entryZone: entry,
        targetPrice: d.targetPrice || null,
        stopLoss: d.stopLoss || null,
        riskRewardRatio: rr ? Math.round(rr * 100) / 100 : null,
        positionSizeSuggestion: d.positionSize || 'AVOID',
        catalysts: d.catalysts || [],
        risks: d.risks || [],
        signals,
        optionsInsight,
        generatedAt: new Date().toISOString(),
        source: 'gemini' as const,
        model,
        latencyMs,
      };
    });

    return {
      decisions,
      marketContext: {
        breadthRatio: context.sessionStats.breadthRatio,
        avgChangePercent: context.sessionStats.avgChangePercent,
        marketBias: parsed.marketBias || 'NEUTRAL',
        totalSymbolsAnalyzed: targetStocks.length,
      },
      generatedAt: new Date().toISOString(),
      totalLatencyMs: latencyMs,
    };
  } catch (error) {
    console.warn('[InstantDecision] Gemini provider failed:', error instanceof Error ? error.message : 'Unknown');
    return null;
  }
}

// ─── Heuristic Fallback ─────────────────────────────────────────────────

/**
 * Rule-based decision engine when LLM is unavailable.
 * Uses momentum, VWAP, trend, and breadth signals.
 */
export function heuristicDecisionProvider(context: LiveDataLLMContext): DecisionBatch {
  const start = Date.now();
  const breadth = context.sessionStats.breadthRatio;
  const marketBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
    breadth >= 0.6 ? 'BULLISH' : breadth <= 0.4 ? 'BEARISH' : 'NEUTRAL';

  const decisions: InstantDecision[] = context.stocks.map(stock => {
    const signals = generateTechnicalSignals(stock);
    const bullishSignals = signals.filter(s => s.type === 'BULLISH').length;
    const bearishSignals = signals.filter(s => s.type === 'BEARISH').length;

    let action: DecisionAction;
    let confidence: number;
    let urgency: InstantDecision['urgency'];
    let positionSize: InstantDecision['positionSizeSuggestion'];
    let reasoning: string;

    const netSignals = bullishSignals - bearishSignals;

    if (netSignals >= 3 && marketBias === 'BULLISH') {
      action = 'STRONG_BUY';
      confidence = 75 + Math.min(15, netSignals * 3);
      urgency = 'IMMEDIATE';
      positionSize = 'FULL';
      reasoning = `${bullishSignals} bullish signals converging with broad market strength. Momentum and VWAP confirm.`;
    } else if (netSignals >= 2) {
      action = 'BUY';
      confidence = 60 + Math.min(15, netSignals * 3);
      urgency = 'NEXT_5MIN';
      positionSize = marketBias === 'BEARISH' ? 'QUARTER' : 'HALF';
      reasoning = `Multiple bullish signals (${bullishSignals}) outweigh bearish (${bearishSignals}). ${marketBias !== 'BULLISH' ? 'Reduced size due to market headwind.' : ''}`;
    } else if (netSignals <= -3 && marketBias === 'BEARISH') {
      action = 'STRONG_SELL';
      confidence = 75 + Math.min(15, Math.abs(netSignals) * 3);
      urgency = 'IMMEDIATE';
      positionSize = 'AVOID';
      reasoning = `${bearishSignals} bearish signals with broad market weakness. Exit or hedge immediately.`;
    } else if (netSignals <= -2) {
      action = 'SELL';
      confidence = 55 + Math.min(15, Math.abs(netSignals) * 3);
      urgency = 'NEXT_5MIN';
      positionSize = 'AVOID';
      reasoning = `Bearish dominance (${bearishSignals} signals). Consider reducing exposure.`;
    } else if (Math.abs(netSignals) <= 1 && stock.velocityBps > 5) {
      action = 'WATCH';
      confidence = 40;
      urgency = 'NEXT_5MIN';
      positionSize = 'AVOID';
      reasoning = `High velocity (${stock.velocityBps} bps/tick) but mixed signals. Wait for confirmation.`;
    } else {
      action = 'HOLD';
      confidence = 50;
      urgency = 'NO_RUSH';
      positionSize = 'AVOID';
      reasoning = `No clear edge. ${bullishSignals} bullish vs ${bearishSignals} bearish signals.`;
    }

    // Compute entry/exit levels
    const atr = stock.rangePercent > 0 ? stock.price * (stock.rangePercent / 100) : stock.price * 0.015;
    const entryZone = (action === 'BUY' || action === 'STRONG_BUY')
      ? { low: round(stock.price - atr * 0.2, 2), high: round(stock.price + atr * 0.1, 2) }
      : null;
    const targetPrice = entryZone ? round(stock.price + atr * 1.5, 2) : null;
    const stopLoss = entryZone ? round(stock.price - atr * 0.8, 2) : null;
    const rr = targetPrice && stopLoss && entryZone
      ? round(Math.abs((targetPrice - entryZone.high) / (entryZone.high - stopLoss)), 2)
      : null;

    const optionsInsight = generateOptionsInsight(stock);

    return {
      symbol: stock.symbol,
      action,
      confidence,
      reasoning,
      urgency,
      entryZone,
      targetPrice,
      stopLoss,
      riskRewardRatio: rr,
      positionSizeSuggestion: positionSize,
      catalysts: signals.filter(s => s.type === 'BULLISH').map(s => s.description),
      risks: signals.filter(s => s.type === 'BEARISH').map(s => s.description),
      signals,
      optionsInsight,
      generatedAt: new Date().toISOString(),
      source: 'heuristic' as const,
      model: 'axion-heuristic-v1',
      latencyMs: Date.now() - start,
    };
  });

  return {
    decisions,
    marketContext: {
      breadthRatio: breadth,
      avgChangePercent: context.sessionStats.avgChangePercent,
      marketBias,
      totalSymbolsAnalyzed: context.stocks.length,
    },
    generatedAt: new Date().toISOString(),
    totalLatencyMs: Date.now() - start,
  };
}

// ─── Technical Signal Generator ─────────────────────────────────────────

function generateTechnicalSignals(stock: LiveDataLLMContext['stocks'][0]): TechnicalSignal[] {
  const signals: TechnicalSignal[] = [];

  // VWAP positioning
  if (stock.price > stock.vwap * 1.002) {
    signals.push({ name: 'VWAP_ABOVE', type: 'BULLISH', strength: 'MODERATE', description: `Price above VWAP (₹${stock.vwap})` });
  } else if (stock.price < stock.vwap * 0.998) {
    signals.push({ name: 'VWAP_BELOW', type: 'BEARISH', strength: 'MODERATE', description: `Price below VWAP (₹${stock.vwap})` });
  }

  // 1-minute momentum
  if (stock.momentum1m > 0.15) {
    signals.push({ name: 'MOM_1M_BULLISH', type: 'BULLISH', strength: stock.momentum1m > 0.3 ? 'STRONG' : 'MODERATE', description: `1m momentum +${stock.momentum1m.toFixed(2)}%` });
  } else if (stock.momentum1m < -0.15) {
    signals.push({ name: 'MOM_1M_BEARISH', type: 'BEARISH', strength: stock.momentum1m < -0.3 ? 'STRONG' : 'MODERATE', description: `1m momentum ${stock.momentum1m.toFixed(2)}%` });
  }

  // 5-minute momentum
  if (stock.momentum5m > 0.3) {
    signals.push({ name: 'MOM_5M_BULLISH', type: 'BULLISH', strength: stock.momentum5m > 0.6 ? 'STRONG' : 'MODERATE', description: `5m momentum +${stock.momentum5m.toFixed(2)}% (sustained buying)` });
  } else if (stock.momentum5m < -0.3) {
    signals.push({ name: 'MOM_5M_BEARISH', type: 'BEARISH', strength: stock.momentum5m < -0.6 ? 'STRONG' : 'MODERATE', description: `5m momentum ${stock.momentum5m.toFixed(2)}% (sustained selling)` });
  }

  // Trend streak
  if (stock.trendStreak >= 3 && stock.trendDir === 'UP') {
    signals.push({ name: 'TREND_STREAK_UP', type: 'BULLISH', strength: stock.trendStreak >= 5 ? 'STRONG' : 'MODERATE', description: `${stock.trendStreak} consecutive up-ticks` });
  } else if (stock.trendStreak >= 3 && stock.trendDir === 'DOWN') {
    signals.push({ name: 'TREND_STREAK_DOWN', type: 'BEARISH', strength: stock.trendStreak >= 5 ? 'STRONG' : 'MODERATE', description: `${stock.trendStreak} consecutive down-ticks` });
  }

  // High velocity warning
  if (stock.velocityBps > 8) {
    signals.push({ name: 'HIGH_VELOCITY', type: 'NEUTRAL', strength: 'STRONG', description: `High velocity ${stock.velocityBps} bps/tick — tighten stops` });
  }

  // Day's change context
  if (stock.changePct > 2) {
    signals.push({ name: 'STRONG_DAY_UP', type: 'BULLISH', strength: 'STRONG', description: `Session gain +${stock.changePct.toFixed(1)}%` });
  } else if (stock.changePct < -2) {
    signals.push({ name: 'STRONG_DAY_DOWN', type: 'BEARISH', strength: 'STRONG', description: `Session loss ${stock.changePct.toFixed(1)}%` });
  }

  // Range expansion
  if (stock.rangePercent > 3) {
    signals.push({ name: 'RANGE_EXPANSION', type: 'NEUTRAL', strength: 'MODERATE', description: `Wide intraday range ${stock.rangePercent.toFixed(1)}% — volatile session` });
  }

  return signals;
}

// ─── Options Insight Generator ──────────────────────────────────────────

function generateOptionsInsight(stock: LiveDataLLMContext['stocks'][0]): string | null {
  try {
    const step = getNSEStrikeStep(stock.price);
    const atmStrike = Math.round(stock.price / step) * step;
    const ceGreeks = calculateGreeks({
      spotPrice: stock.price,
      strikePrice: atmStrike,
      daysToExpiry: 7,
      impliedVolatilityPercent: Math.max(15, stock.rangePercent * 8),
      optionType: 'CE',
    });

    const delta = ceGreeks.delta;
    const theta = ceGreeks.theta;

    if (stock.changePct > 1.5 && delta > 0.55) {
      return `ATM ${atmStrike}CE delta ${delta.toFixed(2)} — momentum favors call buyers. Theta decay ₹${Math.abs(theta).toFixed(0)}/day.`;
    } else if (stock.changePct < -1.5 && delta < 0.45) {
      return `ATM ${atmStrike}PE gaining — put delta ${(1 - delta).toFixed(2)}. Consider protective puts.`;
    } else if (stock.rangePercent > 2.5) {
      return `High IV session (range ${stock.rangePercent.toFixed(1)}%). ATM straddle premium elevated — favor credit spreads.`;
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Main Entry Point ───────────────────────────────────────────────────

async function groqDecisionProvider(
  context: LiveDataLLMContext,
  symbols?: string[]
): Promise<DecisionBatch | null> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey || /^(MY_|YOUR_)/.test(apiKey)) return null;

  const targetStocks = symbols
    ? context.stocks.filter(s => symbols.map(x => x.toUpperCase()).includes(s.symbol.toUpperCase()))
    : context.stocks;

  if (targetStocks.length === 0) return null;

  const start = Date.now();
  const stockDataSummary = targetStocks.slice(0, 10).map(s => ({
    symbol: s.symbol,
    price: s.price,
    changePercent: s.changePct,
    high: s.high,
    low: s.low,
    volume: s.volume,
    vwap: s.vwap,
    signals: generateTechnicalSignals(s).map(sig => `${sig.type}:${sig.name}`),
  }));

  const prompt = `Analyze these live NSE stock prices and generate instant trade decisions.
MARKET SESSION:
- Breadth: ${context.sessionStats.breadthRatio} (${context.sessionStats.advancers} advancers / ${context.sessionStats.decliners} decliners)
- Avg Change: ${context.sessionStats.avgChangePercent}%
STOCKS:
${JSON.stringify(stockDataSummary)}
Return JSON with key "decisions" (array of items with symbol, action: STRONG_BUY|BUY|HOLD|SELL|STRONG_SELL|WATCH, confidence: 0-100, reasoning: string, urgency: IMMEDIATE|NEXT_5MIN|SESSION_END|NO_RUSH, positionSize: FULL|HALF|QUARTER|AVOID, targetPrice: number, stopLoss: number, primarySignal: string, catalysts: string[], risks: string[]) and "marketBias": BULLISH|BEARISH|NEUTRAL.`;

  try {
    const res = await callGroqChat({
      prompt,
      system: 'You are a quantitative trading assistant for Indian NSE equities. Return valid JSON only.',
      jsonFormat: true,
      temperature: 0.1,
      maxTokens: 2048,
      timeoutMs: 12_000,
    });
    if (!res?.text) return null;
    const parsed = JSON.parse(res.text);
    const latencyMs = Date.now() - start;
    if (!parsed.decisions || !Array.isArray(parsed.decisions)) return null;

    const decisions: InstantDecision[] = parsed.decisions.map((d: any) => {
      const stockData = targetStocks.find(s => s.symbol === d.symbol);
      const signals = stockData ? generateTechnicalSignals(stockData) : [];
      const optionsInsight = stockData ? generateOptionsInsight(stockData) : null;
      const curPrice = stockData?.price || d.targetPrice || 100;
      const target = typeof d.targetPrice === 'number' ? d.targetPrice : null;
      const stop = typeof d.stopLoss === 'number' ? d.stopLoss : null;
      const rr = target && stop && curPrice !== stop ? Math.abs((target - curPrice) / (curPrice - stop)) : null;

      return {
        symbol: d.symbol,
        action: d.action || 'WATCH',
        confidence: Math.min(100, Math.max(0, Math.round(d.confidence || 60))),
        reasoning: d.reasoning || '',
        urgency: d.urgency || 'NO_RUSH',
        entryZone: d.entryLow && d.entryHigh ? { low: d.entryLow, high: d.entryHigh } : null,
        targetPrice: target,
        stopLoss: stop,
        riskRewardRatio: rr ? Math.round(rr * 100) / 100 : null,
        positionSizeSuggestion: d.positionSize || 'QUARTER',
        catalysts: Array.isArray(d.catalysts) ? d.catalysts : [],
        risks: Array.isArray(d.risks) ? d.risks : [],
        signals,
        optionsInsight,
        generatedAt: new Date().toISOString(),
        source: 'groq' as const,
        model: res.model,
        latencyMs,
      };
    });

    return {
      decisions,
      marketContext: {
        breadthRatio: context.sessionStats.breadthRatio,
        avgChangePercent: context.sessionStats.avgChangePercent,
        marketBias: parsed.marketBias || 'NEUTRAL',
        totalSymbolsAnalyzed: targetStocks.length,
      },
      generatedAt: new Date().toISOString(),
      totalLatencyMs: latencyMs,
    };
  } catch (error) {
    console.warn('[InstantDecision] Groq provider failed:', error instanceof Error ? error.message : 'Unknown');
    return null;
  }
}

/**
 * Generates instant trade decisions for the given live data context.
 * Tries fast Groq first, then Gemini, falls back to heuristic engine.
 */
export async function generateInstantDecisions(
  context: LiveDataLLMContext,
  symbols?: string[],
): Promise<DecisionBatch> {
  // Try ultra-fast Groq first (<400ms)
  const groqResult = await groqDecisionProvider(context, symbols);
  if (groqResult && groqResult.decisions.length > 0) {
    return groqResult;
  }

  // Try Gemini
  const geminiResult = await geminiDecisionProvider(context, symbols);
  if (geminiResult && geminiResult.decisions.length > 0) {
    return geminiResult;
  }

  // Fallback to heuristic engine
  return heuristicDecisionProvider(context);
}

// ─── Utility ────────────────────────────────────────────────────────────

function round(value: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(value * f) / f;
}
