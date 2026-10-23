import { getArtifactProvenance } from '../../../../lib/artifact-provenance';
import { NextRequest, NextResponse } from 'next/server';
import { getLatestPredictions } from '../../../../lib/stock-ai-service';
import { validatePredictionSnapshot } from '../../../../lib/prediction-validity';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const provenance = getArtifactProvenance('latest_predictions.json');
    if (provenance.status !== 'verified') {
      return NextResponse.json(
        { success: false, error: 'Prediction artifact is not verified for serving', provenance },
        { status: 503 }
      );
    }
    const { searchParams } = new URL(request.url);
    const minScore = parseFloat(searchParams.get('minScore') || '0');
    const ticker = searchParams.get('ticker')?.toUpperCase();
    const label = searchParams.get('label');

    let predictions = getLatestPredictions();
    const validity = validatePredictionSnapshot(predictions);
    if (!validity.valid && provenance) {
      provenance.warning = validity.reason;
    }

    if (ticker) {
      predictions = predictions.filter(p => p.Ticker.toUpperCase().includes(ticker));
    }

    if (minScore > 0) {
      predictions = predictions.filter(p => p['Model Score'] >= minScore);
    }

    if (label && label !== 'all') {
      predictions = predictions.filter(p => p.Label.toLowerCase() === label.toLowerCase());
    }

    return NextResponse.json({
      success: true,
      provenance,
      validity,
      accuracyStatus: 'research_candidate',
      count: predictions.length,
      data: predictions,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch predictions' },
      { status: 500 }
    );
  }
}
