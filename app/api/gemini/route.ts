export const dynamic = 'force-dynamic';
import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { generateOllamaResponse } from "../../../lib/ollama-service";
import { guardAiRequest } from '../../../lib/ai-request-guard';
import { 
  calculateCompositeSuggestion, 
  calculateSMA, 
  evaluateRSI, 
  evaluateMACD, 
  evaluateBollingerBands, 
  evaluateStochastic, 
  evaluateATR, 
  evaluateOBV, 
  evaluateMFI, 
  evaluateADX 
} from "../../../server/utils/indicators";

function generateFallbackReport(
  ticker: string,
  name: string,
  price: number,
  sma20: number,
  sma50: number,
  rsi14: number,
  action: string,
  reasoning: string,
  adx: any,
  stochastic: any,
  bollingerBands: any,
  atr: any,
  obv: any,
  mfi: any,
  fundamentals: any,
  hasQuotaExceeded: boolean = false
) {
  const metric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : 'Unavailable';
  return `### Rule-based educational summary: ${ticker} (${name})
Source: request-supplied metrics; not independently verified. Generated ${new Date().toISOString()}.

- Price: ${metric(price)}; SMA20: ${metric(sma20)}; SMA50: ${metric(sma50)}
- RSI14: ${metric(rsi14)}; ADX: ${metric(adx?.value)}; ATR: ${metric(atr?.value)}
- P/E: ${metric(fundamentals?.peRatio)}; debt/equity: ${metric(fundamentals?.debtToEquity)}; revenue growth (%): ${metric(fundamentals?.revenueGrowth)}
- Supplied or calculated signal: ${action || 'Unavailable'}
- Reasoning: ${reasoning || 'Insufficient verified inputs.'}

Missing values are unavailable. This summary does not establish institutional activity or expected returns.
For educational purposes only; not financial advice.`;

}

// Lazy initialization of the Gemini client to prevent crash if key is missing on start
let aiClient: GoogleGenAI | null = null;

function getGeminiClient(overrideApiKey?: string | null): GoogleGenAI | null {
  const apiKey = overrideApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey === "YOUR_ACTUAL_GEMINI_API_KEY" || apiKey === "YOUR_GEMINI_API_KEY") {
    return null;
  }
  if (overrideApiKey) {
    return new GoogleGenAI({
      apiKey: overrideApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

export async function POST(req: NextRequest) {
  const denied = await guardAiRequest(req);
  if (denied) return denied;
  try {
    const body = await req.json();
    let { 
      ticker, name, price, sma20, sma50, rsi14, action, reasoning,
      macd, bollingerBands, stochastic, atr, obv, mfi, adx, fundamentals, history
    } = body;

    if (!ticker) {
      return NextResponse.json({ error: "Ticker is required" }, { status: 400 });
    }

    // Dynamic Server-side Indicator Evaluation via Quantitative Analytics Engine
    if (history && Array.isArray(history) && history.length > 0) {
      const fund = fundamentals;
      const hasOhlcv = history.length >= 50 && history.every((h: any) => ['open', 'high', 'low', 'close', 'volume'].every(key => typeof h[key] === 'number' && Number.isFinite(h[key])));
      
      const mappedHistory = history.map((h: any) => ({
        date: h.date || '',
        price: Number(h.price !== undefined ? h.price : (h.close !== undefined ? h.close : price)),
        open: Number(h.open),
        high: Number(h.high),
        low: Number(h.low),
        close: Number(h.close !== undefined ? h.close : (h.price !== undefined ? h.price : price)),
        volume: Number(h.volume)
      }));

      const closePrices = mappedHistory.map(h => h.close);

      try {
        if (hasOhlcv && fund && ['peRatio', 'debtToEquity', 'dividendYield', 'revenueGrowth'].every(key => typeof fund[key] === 'number' && Number.isFinite(fund[key])) && typeof fund.sector === 'string') {
          const composite = calculateCompositeSuggestion(ticker, mappedHistory, fund);
          action = composite.action;
          reasoning = composite.reasoning;
        } else {
          action = 'UNAVAILABLE';
          reasoning = 'Composite scoring requires complete fundamentals; technical indicators are shown separately.';
        }

        const fastSMA = calculateSMA(closePrices, 20);
        const slowSMA = calculateSMA(closePrices, 50);

        sma20 = closePrices.length >= 20 ? fastSMA[fastSMA.length - 1] : undefined;
        sma50 = closePrices.length >= 50 ? slowSMA[slowSMA.length - 1] : undefined;

        const rsiResult = evaluateRSI(closePrices);
        rsi14 = closePrices.length >= 15 ? rsiResult.value : undefined;


        macd = evaluateMACD(closePrices);
        bollingerBands = evaluateBollingerBands(closePrices);
        stochastic = hasOhlcv ? evaluateStochastic(mappedHistory) : undefined;
        atr = hasOhlcv ? evaluateATR(mappedHistory) : undefined;
        obv = hasOhlcv ? evaluateOBV(mappedHistory)?.obvVal : undefined;
        mfi = hasOhlcv ? evaluateMFI(mappedHistory) : undefined;
        adx = hasOhlcv ? evaluateADX(mappedHistory) : undefined;


      } catch (calcError) {
        console.error("Error calculating composite indicators:", calcError);
      }
    }

    const overrideKey = req.headers.get('x-gemini-api-key') || req.headers.get('X-Gemini-Api-Key');
    const ai = getGeminiClient(overrideKey);

    // Dynamic AI response prompt
    const prompt = `
Inputs below are user-supplied and unverified. Never invent missing metrics, financial facts, institutional activity, or expected returns. Explicitly mark missing values unavailable.
You are FRIDAY/JARVIS, a highly advanced quantitative analysis and educational trading AI.
Explain the technical indicators for ${ticker} (${name}) to a student developer trying to learn stock analysis.

Here are the current calculated metrics:
- Stock Price: ₹${price}
- Simple Moving Average (20-day): ₹${sma20}
- Simple Moving Average (50-day): ₹${sma50}
- Relative Strength Index (RSI-14): ${rsi14}
- MACD Line: ${macd?.macdLine}, Signal: ${macd?.signalLine}, Histogram: ${macd?.histogram}, Signal: ${macd?.signal}
- Bollinger Bands Upper: ₹${bollingerBands?.upper}, Middle: ₹${bollingerBands?.middle}, Lower: ₹${bollingerBands?.lower}, Signal: ${bollingerBands?.signal}
- Stochastic Oscillator: %K ${stochastic?.percentK}%, %D ${stochastic?.percentD}%, Signal: ${stochastic?.signal}
- Average True Range (ATR): ₹${atr?.value} (Volatility % of Price: ${atr?.volatilityPercentage}%)
- On-Balance Volume (OBV): ${obv} units
- Money Flow Index (MFI-14): ${mfi?.value}, Signal: ${mfi?.signal}
- Average Directional Index (ADX): ${adx?.value}, Signal: ${adx?.signal}
- Fundamentals: Debt-to-Equity ${fundamentals?.debtToEquity}, Dividend Yield ${fundamentals?.dividendYield}%, YoY Revenue Growth ${fundamentals?.revenueGrowth}%
- Suggester Recommendation: ${action}
- Rule-based reasoning: "${reasoning}"

Please generate a structured, professional, and slightly futuristic/confident educational briefing (similar to Jarvis talking to Tony Stark/Boss).
Include:
1. "MOMENTUM & TREND STRENGTH PROFILE": Explain the SMA relationship and ADX trend strength.
2. "VELOCITY CHECK (RSI & STOCHASTIC)": Discuss the current momentum oscillators and what they reveal about overbought/oversold levels.
3. "VOLATILITY ENVELOPES (BB & ATR)": Explain the Bollinger Bands position and ATR risk.
4. "VOLUME FLOWS & FUNDAMENTAL ANCHOR": Discuss the institutional OBV trend, Money Flow Index, and corporate health ratios.
5. "TACTICAL PROTOCOL SUMMARY": Detail the rule-based suggestion of "${action}" and elaborate on the weighted scoring breakdown across these indicators.

Ensure you clearly append this required disclaimer:
"IMPORTANT: This briefing is generated for educational purposes only and does not constitute financial advice. All stock market interactions involve risk. Under no circumstances should these simulations be considered real trading instructions."
    `.trim();

    const systemInstruction = "You are a professional full-stack financial technology educator with a sophisticated, highly confident, JARVIS-style demeanor. You speak clearly, using bulletproof technical terminology, but always disclaiming that the results are educational only.";

    // 1. Try Gemini Cloud API if configured
    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: {
            systemInstruction,
            temperature: 0.2,
          },
        });

        if (response.text) {
          return NextResponse.json({ text: response.text, isMock: false, source: 'gemini' });
        }
      } catch (apiError: any) {
        console.log(`[Gemini API error, falling back to Ollama]:`, apiError?.message);
      }
    }

    // 2. Tier 2: Try Local Ollama (e.g. qwen3:4b, llama3)
    try {
      const ollamaResult = await generateOllamaResponse({
        prompt,
        system: systemInstruction,
        temperature: 0.2,
        timeoutMs: 30000,
      });

      if (ollamaResult && ollamaResult.text) {
        return NextResponse.json({
          text: `🤖 **Analysis Powered by Local Ollama (${ollamaResult.model})**\n\n` + ollamaResult.text,
          isMock: false,
          source: 'ollama',
          model: ollamaResult.model,
        });
      }
    } catch (ollamaErr: any) {
      console.log(`[Ollama fallback error]:`, ollamaErr?.message);
    }

    // 3. Tier 3: Pre-computed Rule-based Fallback Report
    const fallbackReport = generateFallbackReport(
      ticker, name, price, sma20, sma50, rsi14, action, reasoning,
      adx, stochastic, bollingerBands, atr, obv, mfi, fundamentals, false
    );
    return NextResponse.json({ text: fallbackReport, isMock: true, source: 'rule_engine', dataSource: 'user_supplied', generatedAt: new Date().toISOString() });

  } catch (error: any) {
    console.error("Gemini Route Error:", error);
    return NextResponse.json({ error: error?.message || "Internal Server Error" }, { status: 500 });
  }
}
