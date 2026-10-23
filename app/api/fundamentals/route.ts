import { getAxionProjectRoot } from '../../../lib/project-root';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const FUNDAMENTALS_DIR = path.join(getAxionProjectRoot(), 'stock-ai', 'data', 'fundamentals');
const SUMMARY_FILE = path.join(FUNDAMENTALS_DIR, 'fundamentals_summary.json');

function loadSummary(): Record<string, any> {
  try {
    if (fs.existsSync(SUMMARY_FILE)) {
      const raw = fs.readFileSync(SUMMARY_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('[Fundamentals API] Failed to load summary:', e);
  }
  return {};
}

function loadTickerFile(ticker: string): Record<string, any> | null {
  const safeName = ticker.replace(/\./g, '_').replace(/\^/g, '') + '.json';
  const filePath = path.join(FUNDAMENTALS_DIR, safeName);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error(`[Fundamentals API] Failed to load ${filePath}:`, e);
  }
  return null;
}

// GET /api/fundamentals?ticker=RELIANCE.NS
// GET /api/fundamentals?tickers=RELIANCE.NS,TCS.NS  (batch)
// GET /api/fundamentals  (return all summary)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ticker = searchParams.get('ticker');
    const tickersBatch = searchParams.get('tickers');

    if (ticker) {
      // Single ticker — try per-file first, then summary, handling .NS suffix
      const altTicker = ticker.endsWith('.NS') ? ticker.replace('.NS', '') : `${ticker}.NS`;
      const data = loadTickerFile(ticker) || loadTickerFile(altTicker) || loadSummary()[ticker] || loadSummary()[altTicker];
      if (!data) {
        return NextResponse.json(
          { success: false, error: `No fundamental data found for ${ticker}` },
          { status: 404 }
        );
      }
      return NextResponse.json({ success: true, ticker, data });
    }

    if (tickersBatch) {
      const tickers = tickersBatch.split(',').map(t => t.trim()).filter(Boolean);
      const summary = loadSummary();
      const result: Record<string, any> = {};
      for (const t of tickers) {
        result[t] = loadTickerFile(t) || summary[t] || null;
      }
      return NextResponse.json({ success: true, count: tickers.length, data: result });
    }

    // No ticker specified — return full summary (keys + quality_score only for efficiency)
    const summary = loadSummary();
    const lite: Record<string, any> = {};
    for (const [t, d] of Object.entries(summary)) {
      if (d && typeof d === 'object') {
        lite[t] = {
          ticker: t,
          company_name: (d as any).company_name,
          sector: (d as any).sector,
          pe_ratio: (d as any).pe_ratio,
          roe: (d as any).roe,
          revenue_growth: (d as any).revenue_growth,
          quality_score: (d as any).quality_score,
          dividend_yield: (d as any).dividend_yield,
          debt_to_equity: (d as any).debt_to_equity,
        };
      }
    }
    return NextResponse.json({
      success: true,
      count: Object.keys(lite).length,
      data: lite,
    });

  } catch (error: any) {
    console.error('[Fundamentals API] Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
