import { NextRequest, NextResponse } from 'next/server';
import { getLatestNseMarketInsights, getNseStockDelivery } from '@/lib/nse-smart-money';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ticker = searchParams.get('ticker');

    if (ticker) {
      const stockDelivery = await getNseStockDelivery(ticker);
      return NextResponse.json({
        success: true,
        ticker: ticker.toUpperCase(),
        delivery: stockDelivery,
        hasDeliveryData: stockDelivery !== null,
      });
    }

    const insights = await getLatestNseMarketInsights();
    return NextResponse.json({
      success: true,
      insights,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to load NSE Smart Money insights.',
      },
      { status: 500 }
    );
  }
}
