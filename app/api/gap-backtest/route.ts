import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { success: false, error: 'Historical gap backtest is unavailable because no validated historical dataset is configured.' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  );
}
