import { NextRequest, NextResponse } from 'next/server';
import { getFeatureImportance } from '../../../../lib/stock-ai-service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const features = getFeatureImportance();
    return NextResponse.json({
      success: true,
      count: features.length,
      data: features,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch features' },
      { status: 500 }
    );
  }
}
