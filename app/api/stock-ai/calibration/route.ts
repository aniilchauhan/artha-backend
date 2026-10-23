import { getArtifactProvenance } from '../../../../lib/artifact-provenance';
import { NextRequest, NextResponse } from 'next/server';
import { getCalibrationReport } from '../../../../lib/stock-ai-service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const provenance = getArtifactProvenance('evaluation_report.json');
    if (provenance.status !== 'verified') {
      return NextResponse.json(
        { success: false, error: 'Calibration artifact is not verified for serving', provenance },
        { status: 503 }
      );
    }
    const report = getCalibrationReport();
    if (!report) {
      return NextResponse.json(
        { success: false, error: 'Calibration report not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({
      success: true,
      provenance,
      data: report,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch calibration data' },
      { status: 500 }
    );
  }
}
