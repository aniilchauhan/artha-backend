import { getAxionProjectRoot } from '../../../lib/project-root';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const MACRO_FILE = path.join(getAxionProjectRoot(), 'stock-ai', 'data', 'macro', 'macro_snapshot.json');

// Fallback macro data when no snapshot exists yet
const MACRO_FALLBACK = {
  fetched_at: new Date().toISOString(),
  indicators: {
    crude: { symbol: 'BZ=F', name: 'Brent Crude Oil', unit: 'USD/bbl', icon: '🛢️', price: null, change_1d_pct: null, sector_impact: 'Energy, Transport, FMCG' },
    gold: { symbol: 'GC=F', name: 'Gold', unit: 'USD/oz', icon: '🥇', price: null, change_1d_pct: null, sector_impact: 'Metals, Jewellery, Safe Haven' },
    silver: { symbol: 'SI=F', name: 'Silver', unit: 'USD/oz', icon: '🥈', price: null, change_1d_pct: null, sector_impact: 'Metals, Industrial' },
    usdinr: { symbol: 'USDINR=X', name: 'USD/INR', unit: 'INR per USD', icon: '💱', price: null, change_1d_pct: null, sector_impact: 'IT, Pharma, Exports' },
    vix_india: { symbol: '^INDIAVIX', name: 'India VIX', unit: 'Points', icon: '📉', price: null, change_1d_pct: null, sector_impact: 'Fear index' },
    vix_us: { symbol: '^VIX', name: 'CBOE VIX (US)', unit: 'Points', icon: '🌐', price: null, change_1d_pct: null, sector_impact: 'Global risk-off' },
    us10y: { symbol: '^TNX', name: 'US 10Y Yield', unit: '% p.a.', icon: '📈', price: null, change_1d_pct: null, sector_impact: 'Banking, NBFC' },
    dxy: { symbol: 'DX-Y.NYB', name: 'Dollar Index (DXY)', unit: 'Index', icon: '💵', price: null, change_1d_pct: null, sector_impact: 'FII flows' },
    nifty50: { symbol: '^NSEI', name: 'Nifty 50', unit: 'Points', icon: '🇮🇳', price: null, change_1d_pct: null, sector_impact: 'Broad market' },
    banknifty: { symbol: '^NSEBANK', name: 'Bank Nifty', unit: 'Points', icon: '🏦', price: null, change_1d_pct: null, sector_impact: 'Banking' },
  },
  signals: [],
};

function loadMacroSnapshot(): any {
  try {
    if (fs.existsSync(MACRO_FILE)) {
      const raw = fs.readFileSync(MACRO_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('[Macro API] Failed to load macro snapshot:', e);
  }
  return null;
}

function isSnapshotStale(snapshot: any, maxAgeHours: number = 8): boolean {
  try {
    const fetchedAt = new Date(snapshot.fetched_at);
    const ageMs = Date.now() - fetchedAt.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    return ageHours > maxAgeHours;
  } catch {
    return true;
  }
}

// GET /api/macro                → full macro snapshot
// GET /api/macro?key=crude      → single indicator
// GET /api/macro?signals=true   → only market signals
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const key = searchParams.get('key');
    const signalsOnly = searchParams.get('signals') === 'true';

    const snapshot = loadMacroSnapshot();
    const isStale = snapshot ? isSnapshotStale(snapshot) : true;
    const data = snapshot || MACRO_FALLBACK;

    if (signalsOnly) {
      return NextResponse.json({
        success: true,
        is_stale: isStale,
        fetched_at: data.fetched_at,
        signals: data.signals || [],
      });
    }

    if (key) {
      const indicator = data.indicators?.[key];
      if (!indicator) {
        return NextResponse.json(
          { success: false, error: `Unknown macro key: ${key}. Available: ${Object.keys(data.indicators || {}).join(', ')}` },
          { status: 404 }
        );
      }
      return NextResponse.json({ success: true, key, is_stale: isStale, data: indicator });
    }

    return NextResponse.json({
      success: true,
      is_stale: isStale,
      fetched_at: data.fetched_at,
      indicators: data.indicators,
      signals: data.signals || [],
    });

  } catch (error: any) {
    console.error('[Macro API] Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal server error', data: MACRO_FALLBACK },
      { status: 500 }
    );
  }
}
