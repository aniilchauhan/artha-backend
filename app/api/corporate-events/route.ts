import { getAxionProjectRoot } from '../../../lib/project-root';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const EVENTS_FILE = path.join(getAxionProjectRoot(), 'stock-ai', 'data', 'corporate_events', 'events.json');

let cachedEventsIndex: Record<string, any[]> | null = null;
let cachedEventsExpires = 0;

function loadEventsIndex(): Record<string, any[]> {
  const now = Date.now();
  if (cachedEventsIndex && cachedEventsExpires > now) {
    return cachedEventsIndex;
  }
  try {
    if (fs.existsSync(EVENTS_FILE)) {
      const raw = fs.readFileSync(EVENTS_FILE, 'utf-8');
      cachedEventsIndex = JSON.parse(raw);
      cachedEventsExpires = now + 300_000;
      return cachedEventsIndex || {};
    }
  } catch (e) {
    console.error('[Events API] Failed to load events index:', e);
  }
  return {};
}

function refreshDaysAway(events: any[]): any[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return events.map(e => {
    const evtDate = new Date(e.date);
    const diffMs = evtDate.getTime() - today.getTime();
    const daysAway = Math.round(diffMs / (1000 * 60 * 60 * 24));
    return { ...e, days_away: daysAway };
  }).filter(e => e.days_away >= -1); // Keep events from yesterday onwards
}

// GET /api/corporate-events?ticker=RELIANCE.NS         → events for single ticker
// GET /api/corporate-events/upcoming?days=14            → all events within N days
// GET /api/corporate-events?type=results                → filter by event type
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ticker = searchParams.get('ticker');
    const eventType = searchParams.get('type');
    const days = parseInt(searchParams.get('days') || '14', 10);

    const index = loadEventsIndex();

    if (ticker) {
      const altTicker = ticker.endsWith('.NS') ? ticker.replace('.NS', '') : `${ticker}.NS`;
      const rawEvents = index[ticker] || index[altTicker] || [];
      const events = refreshDaysAway(rawEvents);
      return NextResponse.json({
        success: true,
        ticker,
        count: events.length,
        events,
      });
    }

    // Aggregate all events across tickers
    const allEvents: any[] = [];
    for (const [t, evts] of Object.entries(index)) {
      const refreshed = refreshDaysAway(evts);
      allEvents.push(...refreshed.map(e => ({ ...e, ticker: t })));
    }

    // Filter by date window
    const upcoming = allEvents
      .filter(e => e.days_away >= -1 && e.days_away <= days)
      .filter(e => !eventType || e.event_type === eventType)
      .sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      success: true,
      count: upcoming.length,
      days_window: days,
      events: upcoming,
    });

  } catch (error: any) {
    console.error('[Events API] Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
