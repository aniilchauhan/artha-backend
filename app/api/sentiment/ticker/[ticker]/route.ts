import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const STOCK_AI_URL = (process.env.STOCK_AI_SERVICE_URL || 'http://127.0.0.1:7860').replace(/\/$/, '');

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await context.params;
    const force = request.nextUrl.searchParams.get('force_refresh') === 'true';
    const targetUrl = `${STOCK_AI_URL}/api/sentiment/ticker/${encodeURIComponent(ticker)}${force ? '?force_refresh=true' : ''}`;

    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Stock AI service returned an error', status: res.status },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: 'Stock AI Sentiment engine unreachable',
        message: err.message,
        timestamp: new Date().toISOString(),
      },
      { status: 502 }
    );
  }
}
