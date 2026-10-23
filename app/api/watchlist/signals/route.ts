import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import { requireAuth, verifyRequestOrigin } from '../../../../lib/auth-guard';
import { getSignalById } from '../../../../lib/signal-storage';
import User from '../../../../models/User';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.authenticated) return auth.response;

  try {
    await connectToDatabase();
    const email = auth.session.user.email.toLowerCase();
    const user = await User.findOne({ email }).select('signalWatchlist').lean();
    if (!user) return NextResponse.json({ error: 'User profile not found.' }, { status: 404 });

    const entries = await Promise.all((user.signalWatchlist ?? []).map(async (signalId: string) => {
      try {
        return { signalId, signal: await getSignalById(signalId) };
      } catch {
        return { signalId, signal: null };
      }
    }));
    return NextResponse.json({ entries }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Signal watchlist unavailable.' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  if (!verifyRequestOrigin(req)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  const auth = await requireAuth(req);
  if (!auth.authenticated) return auth.response;

  try {
    const body = await req.json();
    if (typeof body.signalId !== 'string' || !/^[A-Za-z0-9_-]{8,200}$/.test(body.signalId)) {
      return NextResponse.json({ error: 'A stored signal ID is required.' }, { status: 400 });
    }
    if (!['save', 'remove'].includes(body.action)) {
      return NextResponse.json({ error: 'Choose save or remove.' }, { status: 400 });
    }

    let signal = null;
    if (body.action === 'save') {
      signal = await getSignalById(body.signalId);
      if (!signal || signal.strategyVersion !== 'RAPID-RADAR-RESEARCH-v1' || signal.signalType !== 'WATCHLIST_OBSERVATION') {
        return NextResponse.json({ error: 'Only stored Radar observations can be added here.' }, { status: 404 });
      }
    }

    await connectToDatabase();
    const email = auth.session.user.email.toLowerCase();
    const user = await User.findOne({ email }).select('signalWatchlist');
    if (!user) return NextResponse.json({ error: 'User profile not found.' }, { status: 404 });

    const ids: string[] = user.signalWatchlist ?? [];
    if (body.action === 'save' && !ids.includes(body.signalId) && ids.length >= 100) {
      return NextResponse.json({ error: 'Signal watchlist limit reached (100).' }, { status: 409 });
    }
    if (body.action === 'save') user.signalWatchlist.addToSet(body.signalId);
    else user.signalWatchlist.pull(body.signalId);
    await user.save();

    return NextResponse.json({
      success: true,
      signalIds: user.signalWatchlist,
      entry: body.action === 'save' ? { signalId: body.signalId, signal } : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Signal watchlist update failed.' }, { status: 503 });
  }
}
