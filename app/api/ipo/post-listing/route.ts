import { NextRequest, NextResponse } from 'next/server';
import { getPostIpoBreakoutsAsync } from '../../../../lib/post-ipo-engine';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || undefined;
    const sector = searchParams.get('sector') || undefined;
    const minScoreStr = searchParams.get('minScore');
    const minScore = minScoreStr ? parseInt(minScoreStr, 10) : undefined;
    const live = searchParams.get('live') !== 'false';


    const result = await getPostIpoBreakoutsAsync({
      status,
      sector,
      minScore,
      live,
    });

    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('Error in /api/ipo/post-listing:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Internal server error processing post-IPO breakouts',
      },
      { status: 500 }
    );
  }
}
