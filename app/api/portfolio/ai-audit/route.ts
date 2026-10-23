import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { generateOllamaResponse } from '../../../../lib/ollama-service';
import { generatePortfolioAiAudit, PortfolioAiAuditResult } from '../../../../lib/portfolio-ai-audit';
import { PortfolioPerformanceResult } from '../../../../lib/portfolio-performance';

export const dynamic = 'force-dynamic';

let aiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey === 'YOUR_ACTUAL_GEMINI_API_KEY' || apiKey === 'YOUR_GEMINI_API_KEY') {
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const perf: PortfolioPerformanceResult = body.performance;

    if (!perf || typeof perf.realized !== 'number') {
      return NextResponse.json({ error: 'Valid portfolio performance result is required' }, { status: 400 });
    }

    // Default institutional rule-based quantitative audit
    const baseAudit = generatePortfolioAiAudit(perf, { source: 'quant_engine' });

    // Attempt Gemini or Ollama enhancement if available
    const gemini = getGeminiClient();
    if (gemini) {
      try {
        const prompt = `You are summarizing a user's local portfolio ledger. It may contain manual entries, imports, incomplete data, or estimates and is not evidence of future performance.
Summarize these records descriptively:
- Period Gross Realized P&L: ₹${perf.realized.toFixed(2)}
- Statutory Delivery Charges: ₹${perf.totalCharges.toFixed(2)} (${perf.chargesDragPct.toFixed(1)}% drag)
- Net Realized P&L: ₹${perf.netRealized.toFixed(2)}
- Total Closed Trades: ${perf.closedTrades.length} (Wins: ${perf.winningTrades}, Losses: ${perf.losingTrades}, Win Rate: ${perf.winRate.toFixed(1)}%)
- Profit Factor: ${perf.profitFactor.toFixed(2)}
- Payoff Ratio: ${perf.payoffRatio.toFixed(2)}x (Avg Win: ₹${perf.avgWin.toFixed(0)} vs Avg Loss: ₹${perf.avgLoss.toFixed(0)})
- Expectancy Per Trade: ₹${perf.expectancyPerTrade.toFixed(2)}
- Avg Holding Days: ${perf.avgHoldingDays} days

Do not provide tax, trading, investment, or position-sizing recommendations. Avoid claims of a statistical edge. Provide 2 to 3 concise sentences describing the recorded figures and noting that charge estimates may differ from the broker statement.`;

        const response = await gemini.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
        });

        const text = response.text?.trim();
        if (text) {
          const enhancedAudit: PortfolioAiAuditResult = {
            ...baseAudit,
            source: 'gemini',
            executiveSummary: text,
          };
          return NextResponse.json({ success: true, audit: enhancedAudit });
        }
      } catch (geminiError: any) {
        console.warn('[Gemini AI Audit fallback]:', geminiError?.message);
      }
    }

    // Attempt Ollama if local instance is running
    try {
      const ollamaRes = await generateOllamaResponse({
        prompt: `Describe this local transaction ledger using only these recorded metrics: Gross P&L ₹${perf.realized}, Net P&L ₹${perf.netRealized}, Profit Factor ${perf.profitFactor}, Win Rate ${perf.winRate}%, Charges Drag ${perf.chargesDragPct}%. Do not give tax, trading, investment, or position-sizing recommendations, and do not claim statistical edge or predict future results.`,
        system: 'You summarize user-entered or imported portfolio records. Cost estimates may differ from broker statements.',
        temperature: 0.3,
        numPredict: 200,
        timeoutMs: 15000,
      });
      if (ollamaRes && ollamaRes.text) {
        const enhancedAudit: PortfolioAiAuditResult = {
          ...baseAudit,
          source: 'ollama',
          executiveSummary: ollamaRes.text.trim(),
        };
        return NextResponse.json({ success: true, audit: enhancedAudit });
      }
    } catch {
      // Ignore Ollama errors and use base audit
    }

    // Return the quantitative audit
    return NextResponse.json({ success: true, audit: baseAudit });
  } catch (error: any) {
    console.error('Portfolio AI Audit error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to generate AI performance audit' }, { status: 500 });
  }
}
