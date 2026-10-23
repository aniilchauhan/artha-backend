import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    error: 'Correlation data is unavailable from this endpoint. The Quant Suite calculates it from provider history already loaded in the active session.',
  }, { status: 503 });
}
