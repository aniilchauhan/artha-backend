import { NextRequest, NextResponse } from 'next/server';
import { getPostIpoBreakoutsAsync } from '../../../../lib/post-ipo-engine';
import { calculatePostIpoPrediction } from '../../../../lib/post-ipo-prediction-model';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || undefined;
    const sector = searchParams.get('sector') || undefined;
    const year = searchParams.get('year') || undefined;
    const live = searchParams.get('live') !== 'false';

    const result = await getPostIpoBreakoutsAsync({
      status,
      sector,
      live,
    });

    let filteredData = result.data;
    if (year && year !== 'all') {
      const y = parseInt(year, 10);
      filteredData = filteredData.filter(item => {
        const itemYear = item.ipoYear || new Date(item.listingDate).getFullYear();
        return itemYear === y;
      });
    }

    return NextResponse.json({
      ...result,
      count: filteredData.length,
      data: filteredData,
    }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error: any) {
    console.error('Error in GET /api/post-ipo/predict:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch post-IPO prediction dataset' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { ticker, overrides } = body;

    if (!ticker) {
      return NextResponse.json(
        { success: false, error: 'Ticker symbol is required' },
        { status: 400 }
      );
    }

    const result = await getPostIpoBreakoutsAsync({ live: false });
    const candidate = result.data.find(
      c => c.ticker.toUpperCase() === ticker.toUpperCase() || c.symbol.toUpperCase() === ticker.toUpperCase()
    );

    if (!candidate) {
      return NextResponse.json(
        { success: false, error: `IPO candidate ${ticker} not found in 2-year cohort` },
        { status: 404 }
      );
    }

    const prediction = calculatePostIpoPrediction(candidate, overrides);

    return NextResponse.json({
      success: true,
      candidate,
      prediction,
      simulatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error in POST /api/post-ipo/predict:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to compute post-IPO prediction' },
      { status: 500 }
    );
  }
}
