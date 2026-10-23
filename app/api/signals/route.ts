import { NextRequest, NextResponse } from 'next/server';
import {
  saveSignalSnapshot,
  getSignalById,
  getAllSignalRevisions,
  listRecentSignals,
} from '@/lib/signal-storage';
import type { DecisionSignal } from '@/lib/signal-schema';
import { requireAdmin, verifyRequestOrigin } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const symbol = searchParams.get('symbol');
    const deduplicationKey = searchParams.get('deduplicationKey');
    const strategyVersion = searchParams.get('strategyVersion') || undefined;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 50;

    // Single signal by ID
    if (id) {
      const signal = await getSignalById(id);
      if (!signal) {
        return NextResponse.json(
          { success: false, error: 'Signal not found', id },
          { status: 404 }
        );
      }
      return NextResponse.json({ success: true, signal });
    }

    // Historical revisions for a key
    if (deduplicationKey) {
      const revisions = await getAllSignalRevisions(deduplicationKey);
      return NextResponse.json({
        success: true,
        count: revisions.length,
        deduplicationKey,
        revisions,
      });
    }

    // List recent signals with optional filters
    const all = await listRecentSignals({ strategyVersion, limit });
    const filtered = symbol
      ? all.filter((s) => s.symbol.toUpperCase() === symbol.toUpperCase())
      : all;

    return NextResponse.json({
      success: true,
      count: filtered.length,
      signals: filtered,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to query signals' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!verifyRequestOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  const auth = await requireAdmin(request);
  if (!auth.authorized) return auth.response;
  try {
    const body = await request.json();

    // Check if migrating browser cache
    if (body.action === 'migrate_browser' && body.candidate) {
      return NextResponse.json({error:'Personal browser watchlists cannot be imported into the shared research archive.'},{status:400});
    }

    const signal = body as DecisionSignal;
    if (!signal.symbol || !signal.strategyVersion || !signal.conditions) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required signal fields: symbol, strategyVersion, and conditions are mandatory.',
        },
        { status: 400 }
      );
    }

    // Persistence validates all fields and recomputes the canonical hash.
    const result = await saveSignalSnapshot(signal);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to save signal snapshot' },
      { status: 500 }
    );
  }
}
