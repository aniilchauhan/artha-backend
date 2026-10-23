import { NextResponse } from 'next/server';
import {
  loadObservations,
  loadAllReconciledObservations,
  evaluateCohortPerformance,
} from '../../../lib/paper-prediction-service';
import type { PredictionCohort } from '../../../lib/paper-prediction-types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionDate = searchParams.get('date') || new Date().toISOString().split('T')[0];

    const currentObservations = loadObservations(sessionDate);
    const allReconciled = loadAllReconciledObservations();

    const cohorts: PredictionCohort[] = [
      'COHORT_A_CLEAN_MODEL',
      'COHORT_B_MODEL_AND_FILINGS',
      'COHORT_C_MODEL_FILINGS_SOCIAL',
    ];

    const cohortReports = cohorts.map(cohort => ({
      ...evaluateCohortPerformance(cohort, allReconciled),
      eligibleForPromotion: false,
      archiveOnly: true,
    }));

    return NextResponse.json({
      success: true,
      archiveOnly: true,
      warning: 'Legacy cohort values are unverified and must not be used as calibration or strategy-performance evidence.',
      sessionDate,
      cohorts: cohortReports,
      currentObservations,
      reconciledHistory: allReconciled.slice(-50).reverse(), // Last 50 trades
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to retrieve paper predictions' },
      { status: 500 }
    );
  }
}

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: 'This legacy cohort simulator is read-only because its write path used seeded prices and simulated candles.',
      replacement: '/rapid-moves and /research-paper',
    },
    { status: 410, headers: { 'Cache-Control': 'no-store' } }
  );
}
