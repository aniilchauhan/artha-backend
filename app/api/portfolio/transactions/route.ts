import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * The former endpoint generated synthetic transaction history. Keep the retired
 * route explicit so stale clients cannot turn sample rows into portfolio data.
 */
export async function POST() {
  return NextResponse.json({
    error: 'Synthetic portfolio transactions are retired.',
    portfolio: '/portfolio',
    manualTracker: '/portfolio-tracker',
  }, { status: 410 });
}
