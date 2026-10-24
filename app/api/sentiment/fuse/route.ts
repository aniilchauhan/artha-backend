import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const STOCK_AI_URL = (process.env.STOCK_AI_SERVICE_URL || 'http://127.0.0.1:7860').replace(/\/$/, '');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const targetUrl = `${STOCK_AI_URL}/api/sentiment/fuse`;

    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Stock AI signal fusion returned an error', status: res.status },
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
        error: 'Stock AI Signal Fusion engine unreachable',
        message: err.message,
        timestamp: new Date().toISOString(),
      },
      { status: 502 }
    );
  }
}
