import { NextRequest, NextResponse } from 'next/server';
import { calculateOptionEnvelope } from '../../../../lib/option-chain';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get('symbol') || searchParams.get('ticker');
    const priceStr = searchParams.get('price') || searchParams.get('currentPrice');
    const prevCloseStr = searchParams.get('previousClose') || searchParams.get('prevClose');
    const ivStr = searchParams.get('iv');

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: 'Query parameter "symbol" or "ticker" is required' },
        { status: 400 }
      );
    }

    const price = priceStr ? parseFloat(priceStr) : NaN;
    const prevClose = prevCloseStr ? parseFloat(prevCloseStr) : NaN;
    const iv = ivStr ? parseFloat(ivStr) : undefined;

    if (!Number.isFinite(price) || price <= 0) {
      return NextResponse.json(
        { success: false, error: 'Positive finite "price" is required' },
        { status: 400 }
      );
    }

    if (!Number.isFinite(prevClose) || prevClose <= 0) {
      return NextResponse.json(
        { success: false, error: 'Positive finite "previousClose" is required' },
        { status: 400 }
      );
    }

    const envelope = calculateOptionEnvelope(symbol.toUpperCase(), price, prevClose, iv);

    return NextResponse.json({
      success: true,
      envelope,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to compute option envelope' },
      { status: 500 }
    );
  }
}
