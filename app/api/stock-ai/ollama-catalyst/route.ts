import { NextRequest, NextResponse } from 'next/server';
import { guardAiRequest } from '../../../../lib/ai-request-guard';
import { generateOllamaResponse, isOllamaRunning, getOllamaModels, pickPreferredOllamaModel } from '../../../../lib/ollama-service';
import {
  calculateSMA,
  evaluateRSI,
  evaluateMACD,
  evaluateBollingerBands,
  evaluateATR,
  calculateCompositeSuggestion,
} from '../../../../server/utils/indicators';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export interface OllamaCatalystAnalysis {
  ticker: string;
  name: string;
  model: string;
  provider: 'ollama_local' | 'rule_engine';
  offline: boolean;
  generatedAt: string;
  latencyMs: number;
  verdict: 'supports_breakout' | 'consolidation_watch' | 'conflicts_with_setup' | 'cautious_reversal';
  verdictLabel: string;
  confidenceScore: number;
  catalystThesis: string;
  breakoutTrigger: string;
  invalidationLevel: string;
  timeHorizon: string;
  technicalAlignment: {
    trendStatus: string;
    rsiStatus: string;
    macdStatus: string;
    volatilityStatus: string;
  };
  risks: string[];
  suggestedAction: string;
}

function generateLocalCatalystFallback(
  ticker: string,
  name: string,
  price: number,
  sma20: number,
  sma50: number,
  rsi: number,
  action: string,
  reason: string
): OllamaCatalystAnalysis {
  const isBullish = price > sma20 && (rsi >= 45 && rsi <= 68);
  const isOverbought = rsi > 70;
  const isOversold = rsi < 30;

  const verdict = isBullish ? 'supports_breakout' : isOverbought ? 'cautious_reversal' : 'consolidation_watch';
  const verdictLabel = isBullish ? 'Bullish Catalyst Alignment' : isOverbought ? 'Caution: Overextended' : 'Consolidation Watch';

  return {
    ticker,
    name: name || ticker,
    model: 'offline-rule-quant',
    provider: 'rule_engine',
    offline: true,
    generatedAt: new Date().toISOString(),
    latencyMs: 12,
    verdict,
    verdictLabel,
    confidenceScore: isBullish ? 74 : 52,
    catalystThesis: isBullish
      ? `Price trading above 20-day SMA (₹${sma20.toFixed(2)}) with healthy RSI (${rsi.toFixed(1)}) indicates constructive accumulation and potential momentum continuation.`
      : `Price relative to SMA20 (₹${sma20.toFixed(2)}) and RSI (${rsi.toFixed(1)}) signals consolidation with directional confirmation pending.`,
    breakoutTrigger: `Decisive daily close above ₹${(price * 1.025).toFixed(2)} with above-average volume.`,
    invalidationLevel: `Break and close below 20-day SMA at ₹${sma20.toFixed(2)} or support at ₹${(price * 0.97).toFixed(2)}.`,
    timeHorizon: '1 to 5 Trading Sessions',
    technicalAlignment: {
      trendStatus: price > sma20 ? 'Above 20-SMA (Positive momentum)' : 'Below 20-SMA (Under pressure)',
      rsiStatus: isOverbought ? 'Overbought (>70)' : isOversold ? 'Oversold (<30)' : `Neutral-Bullish (${rsi.toFixed(1)})`,
      macdStatus: action === 'BUY' ? 'Bullish convergence' : 'Neutral / Cautious',
      volatilityStatus: 'Normal session volatility',
    },
    risks: [
      'Broader Nifty / market-wide sentiment pressure.',
      'False breakout without volume expansion.',
      'Overnight gap risk if global indices turn adverse.',
    ],
    suggestedAction: action || 'HOLD / MONITOR',
  };
}

export async function POST(req: NextRequest) {
  const denied = await guardAiRequest(req);
  if (denied) return denied;

  const startTime = Date.now();

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Valid JSON request body is required.' }, { status: 400 });
    }

    const { ticker, name, price, history } = body;
    if (!ticker || typeof ticker !== 'string') {
      return NextResponse.json({ success: false, error: 'Stock ticker is required.' }, { status: 400 });
    }

    const cleanTicker = ticker.trim().toUpperCase().replace(/\.NS$/, '');
    const stockName = (typeof name === 'string' && name.trim()) || cleanTicker;
    const currentPrice = typeof price === 'number' && Number.isFinite(price) ? price : 0;

    // Check if Ollama is running
    const running = await isOllamaRunning();
    const installedModels = running ? await getOllamaModels() : [];
    const activeModel = pickPreferredOllamaModel(installedModels);

    // Compute indicators if history is available
    let sma20Val = currentPrice;
    let sma50Val = currentPrice;
    let rsiVal = 50;
    let action = 'NEUTRAL';
    let reasoning = 'Awaiting indicator calculation.';

    if (Array.isArray(history) && history.length >= 20) {
      const closes: number[] = history.map((h: any) => h.close || h.price).filter(Number.isFinite);
      if (closes.length >= 20) {
        const sma20Arr = calculateSMA(closes, 20);
        const sma50Arr = calculateSMA(closes, 50);
        const rsiArr = evaluateRSI(closes);
        sma20Val = sma20Arr[sma20Arr.length - 1] || currentPrice;
        sma50Val = sma50Arr[sma50Arr.length - 1] || sma20Val;
        rsiVal = rsiArr?.value || 50;
      }
      try {
        const mappedHistory = history.map((h: any) => ({
          date: String(h.date || ''),
          price: Number(h.close ?? h.price ?? currentPrice),
          open: Number(h.open ?? h.price ?? currentPrice),
          high: Number(h.high ?? h.price ?? currentPrice),
          low: Number(h.low ?? h.price ?? currentPrice),
          close: Number(h.close ?? h.price ?? currentPrice),
          volume: Number(h.volume ?? 100000),
        }));
        const composite = calculateCompositeSuggestion(cleanTicker, mappedHistory, {
          peRatio: 20,
          sector: 'EQUITY',
          debtToEquity: 0.5,
          dividendYield: 1.0,
          revenueGrowth: 10,
        });
        action = composite.action;
        reasoning = composite.reasoning;
      } catch {
        // Continue with default values
      }
    }

    // If Ollama is not running or no model is installed, return local quant rule fallback
    if (!running || !activeModel) {
      const fallback = generateLocalCatalystFallback(
        cleanTicker,
        stockName,
        currentPrice,
        sma20Val,
        sma50Val,
        rsiVal,
        action,
        reasoning
      );
      return NextResponse.json({
        success: true,
        data: fallback,
        notice: 'Local Ollama runtime was not detected. Serving 100% offline rule-based quant analysis.',
      });
    }

    // Build the AI prompt for structured catalyst review
    const systemInstruction = `You are an elite quantitative technical analyst. Provide an ultra-precise, objective catalyst and risk review for the given stock.
Return ONLY valid JSON matching this exact schema:
{
  "verdict": "supports_breakout" | "consolidation_watch" | "conflicts_with_setup" | "cautious_reversal",
  "verdictLabel": "Short summary label (e.g. Bullish Catalyst Alignment)",
  "confidenceScore": number between 10 and 95,
  "catalystThesis": "2-3 concise sentences detailing price action drivers, volume behavior, and catalyst setup",
  "breakoutTrigger": "Specific price level and volume condition required to confirm breakout",
  "invalidationLevel": "Exact price level or indicator failure that voids this thesis",
  "timeHorizon": "1 to 5 Trading Sessions",
  "technicalAlignment": {
    "trendStatus": "SMA alignment summary",
    "rsiStatus": "RSI interpretation",
    "macdStatus": "MACD posture",
    "volatilityStatus": "Volatility and range compression status"
  },
  "risks": [
    "Specific market or sector risk",
    "Downside technical risk",
    "Liquidity or event risk"
  ],
  "suggestedAction": "ACCUMULATE_DIPS" | "BREAKOUT_BUY" | "HOLD_STOP_LOSS" | "WAIT_AND_WATCH"
}`;

    const prompt = `Stock: ${cleanTicker} (${stockName})
Current Price: ₹${currentPrice.toFixed(2)}
20-day SMA: ₹${sma20Val.toFixed(2)} (${currentPrice > sma20Val ? 'Price is ABOVE SMA20' : 'Price is BELOW SMA20'})
50-day SMA: ₹${sma50Val.toFixed(2)} (${currentPrice > sma50Val ? 'Price is ABOVE SMA50' : 'Price is BELOW SMA50'})
RSI (14-day): ${rsiVal.toFixed(1)}
Algorithmic Signal: ${action} (${reasoning})

Evaluate the next 1-5 sessions:
1. Is there a technical catalyst or breakout brewing?
2. What exact level confirms or invalidates it?
3. What are the 3 top risks?`;

    const ollamaResponse = await generateOllamaResponse({
      model: activeModel,
      system: systemInstruction,
      prompt,
      temperature: 0.1,
      timeoutMs: 35000,
      format: 'json',
    });

    const latencyMs = Date.now() - startTime;

    if (!ollamaResponse?.text) {
      const fallback = generateLocalCatalystFallback(
        cleanTicker,
        stockName,
        currentPrice,
        sma20Val,
        sma50Val,
        rsiVal,
        action,
        reasoning
      );
      return NextResponse.json({
        success: true,
        data: fallback,
        notice: 'Ollama local inference timed out. Displaying local quantitative rules.',
      });
    }

    let parsed: any = null;
    try {
      parsed = JSON.parse(ollamaResponse.text);
    } catch {
      // If model returned extra formatting, try extracting JSON substring
      const jsonMatch = ollamaResponse.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          parsed = null;
        }
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      const fallback = generateLocalCatalystFallback(
        cleanTicker,
        stockName,
        currentPrice,
        sma20Val,
        sma50Val,
        rsiVal,
        action,
        reasoning
      );
      return NextResponse.json({ success: true, data: fallback });
    }

    const analysis: OllamaCatalystAnalysis = {
      ticker: cleanTicker,
      name: stockName,
      model: ollamaResponse.model,
      provider: 'ollama_local',
      offline: true,
      generatedAt: new Date().toISOString(),
      latencyMs,
      verdict: parsed.verdict || 'consolidation_watch',
      verdictLabel: parsed.verdictLabel || 'Local AI Review',
      confidenceScore: typeof parsed.confidenceScore === 'number' ? Math.min(95, Math.max(10, parsed.confidenceScore)) : 65,
      catalystThesis: parsed.catalystThesis || 'Analysis generated based on technical moving averages and momentum oscillators.',
      breakoutTrigger: parsed.breakoutTrigger || `Decisive close above ₹${(currentPrice * 1.02).toFixed(2)}`,
      invalidationLevel: parsed.invalidationLevel || `Close below ₹${(currentPrice * 0.98).toFixed(2)}`,
      timeHorizon: parsed.timeHorizon || '1 to 5 Trading Sessions',
      technicalAlignment: {
        trendStatus: parsed.technicalAlignment?.trendStatus || (currentPrice > sma20Val ? 'Above SMA20' : 'Below SMA20'),
        rsiStatus: parsed.technicalAlignment?.rsiStatus || `RSI: ${rsiVal.toFixed(1)}`,
        macdStatus: parsed.technicalAlignment?.macdStatus || action,
        volatilityStatus: parsed.technicalAlignment?.volatilityStatus || 'Normal volatility',
      },
      risks: Array.isArray(parsed.risks) && parsed.risks.length > 0 ? parsed.risks.slice(0, 4) : [
        'Broader market or index pressure.',
        'Volume failure at resistance.',
      ],
      suggestedAction: parsed.suggestedAction || action || 'WAIT_AND_WATCH',
    };

    return NextResponse.json({
      success: true,
      data: analysis,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err?.message || 'Local AI catalyst review failed.',
    }, { status: 500 });
  }
}
