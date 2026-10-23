import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: 'Options chain unavailable: no validated exchange options feed is configured.',
    },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
