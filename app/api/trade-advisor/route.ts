import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { generateOllamaResponse } from "../../../lib/ollama-service";
import { guardAiRequest } from '../../../lib/ai-request-guard';
import {
  callOpenAIChat,
  callAnthropicChat,
  callGroqChat,
  callXaiChat,
  callDeepSeekChat,
  callOpenRouterChat,
} from '../../../lib/free-ai-service';
import { calculateIndianEquityFriction } from '../../../lib/indian-brokerage-calc';

export const dynamic = 'force-dynamic';

// Lazy initialization of the Gemini client to prevent crash if key is missing on start
let aiClient: GoogleGenAI | null = null;

function getFallbackParams(currentPrice: number, riskLevel: string) {
  let buyRangeMin = currentPrice * 0.965;
  let buyRangeMax = currentPrice * 0.99;
  let sellRangeMin = currentPrice * 1.07;
  let sellRangeMax = currentPrice * 1.13;
  let stopLoss = currentPrice * 0.935;
  let profitPotential = "+7.2% to +13.5%";
  let riskRewardRatio = "2.4 : 1";

  if (riskLevel === 'Conservative') {
    buyRangeMin = currentPrice * 0.945;
    buyRangeMax = currentPrice * 0.975;
    sellRangeMin = currentPrice * 1.04;
    sellRangeMax = currentPrice * 1.075;
    stopLoss = currentPrice * 0.925;
    profitPotential = "+4.5% to +8.0%";
    riskRewardRatio = "2.1 : 1";
  } else if (riskLevel === 'Aggressive') {
    buyRangeMin = currentPrice * 0.975;
    buyRangeMax = currentPrice * 1.02;
    sellRangeMin = currentPrice * 1.14;
    sellRangeMax = currentPrice * 1.25;
    stopLoss = currentPrice * 0.905;
    profitPotential = "+14.0% to +25.5%";
    riskRewardRatio = "3.2 : 1";
  } else if (riskLevel === 'Intraday') {
    buyRangeMin = currentPrice * 0.985;
    buyRangeMax = currentPrice * 0.995;
    sellRangeMin = buyRangeMin * 1.03;
    sellRangeMax = buyRangeMax * 1.03;
    stopLoss = buyRangeMin * 0.985;
    profitPotential = "Exactly +3.0% profit target";
    riskRewardRatio = "2.0 : 1";
  }

  return {
    buyRangeMin,
    buyRangeMax,
    sellRangeMin,
    sellRangeMax,
    stopLoss,
    profitPotential,
    riskRewardRatio
  };
}

function auditAndEnforceTradeQuality(params: {
  buyRangeMin: number;
  buyRangeMax: number;
  sellRangeMin: number;
  sellRangeMax: number;
  stopLoss: number;
  profitPotential?: string;
  riskRewardRatio?: string;
  ticker: string;
  currentPrice: number;
  riskLevel?: string;
}) {
  let { buyRangeMin, buyRangeMax, sellRangeMin, sellRangeMax, stopLoss, currentPrice, ticker, riskLevel } = params;

  if (!buyRangeMin || buyRangeMin <= 0) buyRangeMin = currentPrice * 0.98;
  if (!buyRangeMax || buyRangeMax <= 0) buyRangeMax = currentPrice * 1.005;
  if (buyRangeMin > buyRangeMax) [buyRangeMin, buyRangeMax] = [buyRangeMax, buyRangeMin];

  const midEntry = (buyRangeMin + buyRangeMax) / 2;

  // Enforce stop loss strictly BELOW entry
  if (!stopLoss || stopLoss >= midEntry || stopLoss <= 0) {
    const defaultRiskPct = riskLevel === 'Conservative' ? 0.025 : riskLevel === 'Aggressive' ? 0.05 : 0.035;
    stopLoss = Number((midEntry * (1 - defaultRiskPct)).toFixed(2));
  }

  const riskPerShare = Math.max(0.01, midEntry - stopLoss);

  // Enforce target strictly ABOVE entry with MINIMUM 2.0x Reward-to-Risk ratio
  const minRequiredReward = riskPerShare * 2.0;
  const minRequiredTarget = midEntry + minRequiredReward;

  if (!sellRangeMin || sellRangeMin < minRequiredTarget) {
    sellRangeMin = Number(minRequiredTarget.toFixed(2));
  }
  if (!sellRangeMax || sellRangeMax <= sellRangeMin) {
    sellRangeMax = Number((sellRangeMin * 1.05).toFixed(2));
  }

  const midTarget = (sellRangeMin + sellRangeMax) / 2;
  const actualReward = midTarget - midEntry;
  const calculatedRR = Number((actualReward / riskPerShare).toFixed(2));

  // Risk budget calculation (1% portfolio risk on ₹10L default account)
  const defaultAccountSize = 1_000_000;
  const maxRiskRupees = defaultAccountSize * 0.01; // ₹10,000 risk
  const recommendedShares = Math.max(1, Math.floor(maxRiskRupees / riskPerShare));
  const allocatedCapital = Math.round(recommendedShares * midEntry);

  // Statutory friction calculation on Indian delivery trades (STT 0.20%, DP ₹15.93, GST 18%, Stamp Duty, Slippage)
  const frictionBreakdown = calculateIndianEquityFriction({
    entryPrice: midEntry,
    exitPrice: midTarget,
    quantity: recommendedShares,
  });
  const statutoryFrictionPct = frictionBreakdown.totalFrictionPct;
  const netRewardRupees = actualReward * recommendedShares - frictionBreakdown.totalFrictionINR;
  const netRewardPerShare = Math.max(0, netRewardRupees / recommendedShares);
  const netRR = Number((netRewardPerShare / riskPerShare).toFixed(2));

  // Dynamic Ratchet levels
  const statutoryBreakevenPrice = Number((midEntry * 1.008).toFixed(2)); // +0.80% gain to cover all statutory drag
  const profitLockPrice = Number((midEntry * 1.045).toFixed(2)); // +4.50% profit lock

  // Kelly Criterion fraction calculation (assumes 55% win rate at net R:R)
  const winRateAssumption = 0.55;
  const effectiveRR = Math.max(1.0, netRR > 0 ? netRR : calculatedRR);
  const kellyFraction = Math.max(0.05, Math.min(0.25, Number((winRateAssumption - ((1 - winRateAssumption) / effectiveRR)).toFixed(2))));

  const minPotentialPct = ((sellRangeMin - midEntry) / midEntry) * 100;
  const maxPotentialPct = ((sellRangeMax - midEntry) / midEntry) * 100;

  return {
    buyRangeMin: Number(buyRangeMin.toFixed(2)),
    buyRangeMax: Number(buyRangeMax.toFixed(2)),
    sellRangeMin: Number(sellRangeMin.toFixed(2)),
    sellRangeMax: Number(sellRangeMax.toFixed(2)),
    stopLoss: Number(stopLoss.toFixed(2)),
    profitPotential: `+${minPotentialPct.toFixed(1)}% to +${maxPotentialPct.toFixed(1)}%`,
    riskRewardRatio: `${calculatedRR} : 1`,
    statutoryFrictionPct: Number(statutoryFrictionPct.toFixed(2)),
    netRewardRiskRatio: `${netRR} : 1`,
    statutoryBreakevenPrice,
    profitLockPrice,
    qualityGate: {
      passed: calculatedRR >= 1.8,
      rewardRiskRatio: calculatedRR,
      netRewardRiskRatio: netRR,
      statutoryFrictionPct: Number(statutoryFrictionPct.toFixed(2)),
      statutoryFrictionInr: frictionBreakdown.totalFrictionINR,
      statutoryBreakevenPrice,
      profitLockPrice,
      riskPerShareRupees: Number(riskPerShare.toFixed(2)),
      recommendedShares,
      allocatedCapitalRupees: allocatedCapital,
      maxLossRupees: Number((recommendedShares * riskPerShare).toFixed(2)),
      kellyFractionPct: Number((kellyFraction * 100).toFixed(1)),
      ruleSummary: `Institutional 1% Risk Budget: ₹${maxRiskRupees.toLocaleString('en-IN')} max risk across ${recommendedShares} shares. Statutory Friction ~${statutoryFrictionPct.toFixed(2)}% factored. Breakeven ratchet armed at ₹${statutoryBreakevenPrice}.`
    }
  };
}

function generateFallbackAdvisory(
  ticker: string,
  name: string,
  riskLevel: string,
  params: ReturnType<typeof getFallbackParams>,
  hasQuotaExceeded: boolean = false
) {
  return `### Demonstration scenario: ${ticker} (${name})
These illustrative levels are fixed percentage calculations from the supplied price (${riskLevel} preset). They are not verified support, resistance, forecasts, or executable orders.

- Example entry range: ₹${params.buyRangeMin.toFixed(2)}–₹${params.buyRangeMax.toFixed(2)}
- Example target range: ₹${params.sellRangeMin.toFixed(2)}–₹${params.sellRangeMax.toFixed(2)}
- Example stop: ₹${params.stopLoss.toFixed(2)}

Win probability and expected return are unavailable. For educational purposes only; not financial advice.`;
}

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
    const {
      ticker,
      name,
      currentPrice,
      riskLevel
    } = body;

    if (!ticker || !currentPrice) {
      return NextResponse.json({ error: "Ticker and currentPrice are required" }, { status: 400 });
    }

    const overrideKey = req.headers.get('x-gemini-api-key') || req.headers.get('X-Gemini-Api-Key');
    const ai = getGeminiClient(overrideKey);

    const prompt = `
      You are FRIDAY/JARVIS, Tony Stark's premium, highly advanced quantum terminal intelligence and an institutional equity fund strategist for the Indian Stock Market (NSE).
      Analyze the following stock and generate appropriate multi-session swing trade parameters (3 to 7 trading sessions horizon, +8% to +10% target) and a sophisticated advisory briefing.

      - Stock: ${ticker} (${name})
      - Current Price: ₹${currentPrice}
      - Risk Strategy Profile: ${riskLevel || 'Moderate'}

      IMPORTANT INDIAN MARKET STATUTORY CONSTRAINTS:
      - Delivery trades incur ~0.60% to 0.75% round-trip statutory friction (STT 0.20%, flat DP charges ₹15.93, GST 18%, Stamp Duty 0.015%, slippage ~0.20%).
      - Target must provide positive mathematical expectancy AFTER statutory taxes (minimum 2.0x Reward-to-Risk).
      - Include dynamic breakeven ratchet: When stock gains +4.0%, ratchet stop to +0.80% above entry to guarantee zero statutory loss.
      - Include profit trailing lock: When stock gains +7.0%, trail stop to +4.5% above entry.

      Based on the stock price and risk strategy, determine the following quantitative values (use realistic support/resistance math relative to the current price):
      - buyRangeMin (number)
      - buyRangeMax (number)
      - sellRangeMin (number)
      - sellRangeMax (number)
      - stopLoss (number)
      - profitPotential (string, e.g. "+8.5% to +12.0%")
      - riskRewardRatio (string, e.g. "2.8 : 1")

      Then, provide a high-end quantitative report (advisoryReport) with these distinct, structured sections:
      1. "TACTICAL ENTRY PROTOCOL (BUY STRATEGY)": Justify why your chosen accumulation support band is optimal based on technical breakout and liquidity dynamics.
      2. "EXIT EXPECTANCY & STATUTORY DRAG (SELL BOUNDS)": Detail the rationale for taking profit inside your chosen resistance zone, explaining how an +8% to +10% swing target overcomes ~0.70% Indian statutory delivery friction (STT, DP charges, GST).
      3. "DYNAMIC RATCHET & RISK MITIGATION": Detail the two-tier protection plan: ratcheting stop to statutory breakeven (+0.80%) at +4% rally, and trailing profit lock (+4.5%) at +7% rally.
      4. "FRIDAY SYSTEM SYNTHESIS": A confident, brief final summary addressing the user as "Boss" or "Sir" explaining why this trade is a high-synergy selection fitting a ${riskLevel || 'Moderate'} portfolio.

      Keep the tone extremely polished, highly professional, analytical, and respectful yet subtly confident. Do not add markdown headers other than '###' for section headers in the report.
      
      Output MUST be a pure JSON object containing EXACTLY the keys: buyRangeMin, buyRangeMax, sellRangeMin, sellRangeMax, stopLoss, profitPotential, riskRewardRatio, and advisoryReport. Do NOT wrap in markdown \`\`\`json blocks.
    `;

    const systemPrompt = "You are a professional quant fund strategist and automated system trading advisor for Indian equities. Output MUST be valid JSON only. No markdown formatting for the JSON object.";

    // Helper to parse and return audited response
    const handleSuccessfulAiResponse = (rawText: string, source: string, modelName: string, badgeLabel: string) => {
      const cleanJson = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsedData = JSON.parse(cleanJson);
      if (parsedData.buyRangeMin && parsedData.sellRangeMin) {
        const audited = auditAndEnforceTradeQuality({
          buyRangeMin: Number(parsedData.buyRangeMin),
          buyRangeMax: Number(parsedData.buyRangeMax),
          sellRangeMin: Number(parsedData.sellRangeMin),
          sellRangeMax: Number(parsedData.sellRangeMax),
          stopLoss: Number(parsedData.stopLoss),
          ticker,
          currentPrice: Number(currentPrice),
          riskLevel,
        });

        return NextResponse.json({
          isMock: false,
          source,
          model: modelName,
          ...audited,
          advisoryReport: `⚡ **Trade Advisory Powered by ${badgeLabel} (${modelName})**\n\n` + (parsedData.advisoryReport || "")
        });
      }
      return null;
    };

    // ─── Tier 1: OpenAI (o3-mini / GPT-4o) ───────────────────────────────────
    try {
      const openAiRes = await callOpenAIChat({
        prompt,
        system: systemPrompt,
        jsonFormat: true,
        maxTokens: 1400,
        timeoutMs: 25000,
      });
      if (openAiRes?.text) {
        const resp = handleSuccessfulAiResponse(openAiRes.text, 'openai', openAiRes.model, 'OpenAI');
        if (resp) return resp;
      }
    } catch (e: any) {
      console.log('[OpenAI Trade Advisor fallback]:', e?.message);
    }

    // ─── Tier 2: Anthropic Claude (Claude 3.7 Sonnet / 3.5 Sonnet) ────────────
    try {
      const anthropicRes = await callAnthropicChat({
        prompt,
        system: systemPrompt,
        jsonFormat: true,
        maxTokens: 1400,
        timeoutMs: 25000,
      });
      if (anthropicRes?.text) {
        const resp = handleSuccessfulAiResponse(anthropicRes.text, 'anthropic', anthropicRes.model, 'Anthropic Claude');
        if (resp) return resp;
      }
    } catch (e: any) {
      console.log('[Anthropic Trade Advisor fallback]:', e?.message);
    }

    // ─── Tier 3: Groq Cloud (Llama 3.3 70B / DeepSeek R1 Distill) ────────────
    try {
      const groqResult = await callGroqChat({
        prompt,
        system: systemPrompt,
        jsonFormat: true,
        temperature: 0.3,
        maxTokens: 1200,
        timeoutMs: 15000,
      });
      if (groqResult?.text) {
        const resp = handleSuccessfulAiResponse(groqResult.text, 'groq', groqResult.model, 'Groq');
        if (resp) return resp;
      }
    } catch (groqErr: any) {
      console.log('[Groq Trade Advisor fallback]:', groqErr?.message);
    }

    // ─── Tier 4: Gemini Cloud API ────────────────────────────────────────────
    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.3,
            responseMimeType: "application/json",
          },
        });
        const responseText = response.text || "{}";
        const resp = handleSuccessfulAiResponse(responseText, 'gemini', 'gemini-2.5-flash', 'Google Gemini');
        if (resp) return resp;
      } catch (apiError: any) {
        console.log(`[Gemini API error in Trade Advisory for ${ticker}]:`, apiError?.message);
      }
    }

    // ─── Tier 5: xAI Grok (Grok 2 / Grok 3) ─────────────────────────────────
    try {
      const xaiRes = await callXaiChat({
        prompt,
        system: systemPrompt,
        jsonFormat: true,
        maxTokens: 1400,
        timeoutMs: 25000,
      });
      if (xaiRes?.text) {
        const resp = handleSuccessfulAiResponse(xaiRes.text, 'xai', xaiRes.model, 'xAI Grok');
        if (resp) return resp;
      }
    } catch (e: any) {
      console.log('[xAI Trade Advisor fallback]:', e?.message);
    }

    // ─── Tier 6: DeepSeek API (DeepSeek Reasoner R1 / V3) ────────────────────
    try {
      const deepSeekRes = await callDeepSeekChat({
        prompt,
        system: systemPrompt,
        jsonFormat: true,
        maxTokens: 1400,
        timeoutMs: 25000,
      });
      if (deepSeekRes?.text) {
        const resp = handleSuccessfulAiResponse(deepSeekRes.text, 'deepseek', deepSeekRes.model, 'DeepSeek');
        if (resp) return resp;
      }
    } catch (e: any) {
      console.log('[DeepSeek Trade Advisor fallback]:', e?.message);
    }

    // ─── Tier 7: OpenRouter ──────────────────────────────────────────────────
    try {
      const openRouterRes = await callOpenRouterChat({
        prompt,
        system: systemPrompt,
        jsonFormat: true,
        maxTokens: 1200,
        timeoutMs: 20000,
      });
      if (openRouterRes?.text) {
        const resp = handleSuccessfulAiResponse(openRouterRes.text, 'openrouter', openRouterRes.model, 'OpenRouter');
        if (resp) return resp;
      }
    } catch (e: any) {
      console.log('[OpenRouter Trade Advisor fallback]:', e?.message);
    }

    // ─── Tier 8: Local Ollama ────────────────────────────────────────────────
    try {
      const ollamaResult = await generateOllamaResponse({
        prompt,
        system: systemPrompt,
        temperature: 0.3,
        format: 'json',
        numPredict: 850,
        timeoutMs: 45000,
      });
      if (ollamaResult?.text) {
        const resp = handleSuccessfulAiResponse(ollamaResult.text, 'ollama', ollamaResult.model, 'Local Ollama');
        if (resp) return resp;
      }
    } catch (ollamaErr: any) {
      console.log('[Ollama Trade Advisory error]:', ollamaErr?.message);
    }

    // ─── Tier 9: Pre-computed Rule-based Fallback ────────────────────────────
    const fallbackParams = getFallbackParams(currentPrice, riskLevel || 'Moderate');
    const auditedFallback = auditAndEnforceTradeQuality({
      ...fallbackParams,
      ticker,
      currentPrice: Number(currentPrice),
      riskLevel,
    });
    const fallbackAdvisory = generateFallbackAdvisory(ticker, name, riskLevel || 'Moderate', auditedFallback, false);
    return NextResponse.json({ 
      isMock: true,
      source: 'rule_engine',
      dataSource: 'simulated',
      generatedAt: new Date().toISOString(),
      ...auditedFallback,
      advisoryReport: fallbackAdvisory
    });

  } catch (error: any) {
    console.error("Trade Advisor Route Error:", error);
    return NextResponse.json({ error: error?.message || "Internal Server Error" }, { status: 500 });
  }
}

