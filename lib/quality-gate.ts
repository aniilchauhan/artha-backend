export type RejectionReason =
  | 'stale_price'
  | 'stale_fundamentals'
  | 'unverified_artifact'
  | 'adverse_regime'
  | 'low_conviction'
  | 'poor_risk_reward'
  | 'invalid_symbol'
  | 'soic_forensic_failure'
  | 'overconfident_uncalibrated';

export interface SetupInput {
  id: string;
  symbol: string;
  exchange: 'NSE' | 'BSE';
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  convictionScore: number;         // 0–100
  priceDataAsOf: string;           // ISO timestamp
  fundamentalsDataAsOf: string;    // ISO timestamp
  artifactStatus: 'verified' | 'unverified' | 'incompatible' | 'unavailable';
  marketRegime: 'bull' | 'neutral' | 'bear';
  isCalibrated?: boolean;
  calibrationECE?: number;         // 0 to 1, target <= 0.05
  soicForensics?: {
    cfoToPatRatio?: number;
    promoterPledgePct?: number;
    hasPositiveFcf?: boolean;
  };
}

export interface QualityGateResult {
  setupId: string;
  passed: boolean;
  rejectionReasons: RejectionReason[];
}

/**
 * Evaluates a trade setup against all quality gate checks.
 * Never throws — any invalid input results in a failed result with appropriate reasons.
 */
export function evaluateQualityGate(
  setup: SetupInput,
  now: Date = new Date()
): QualityGateResult {
  const reasons: RejectionReason[] = [];

  try {
    // 1. Price freshness check: price data must be no older than 24 hours
    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
    const priceAge = now.getTime() - new Date(setup.priceDataAsOf).getTime();
    if (isNaN(priceAge) || priceAge > TWENTY_FOUR_HOURS_MS) {
      reasons.push('stale_price');
    }

    // 2. Fundamentals freshness check: fundamentals must be no older than 90 days
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
    const fundamentalsAge = now.getTime() - new Date(setup.fundamentalsDataAsOf).getTime();
    if (isNaN(fundamentalsAge) || fundamentalsAge > NINETY_DAYS_MS) {
      reasons.push('stale_fundamentals');
    }

    // 3. Artifact provenance check: must be 'verified'
    if (setup.artifactStatus !== 'verified') {
      reasons.push('unverified_artifact');
    }

    // 4. Regime-direction exclusion
    if (
      (setup.marketRegime === 'bear' && setup.direction === 'LONG') ||
      (setup.marketRegime === 'bull' && setup.direction === 'SHORT')
    ) {
      reasons.push('adverse_regime');
    }

    // 5. Conviction score check: must be >= 60
    if (typeof setup.convictionScore !== 'number' || setup.convictionScore < 60) {
      reasons.push('low_conviction');
    }

    // 6. Risk/reward check: must be >= 1.5
    const riskReward =
      setup.entryPrice != null && setup.stopPrice != null && setup.targetPrice != null
        ? (setup.targetPrice - setup.entryPrice) / (setup.entryPrice - setup.stopPrice)
        : NaN;
    if (isNaN(riskReward) || riskReward < 1.5) {
      reasons.push('poor_risk_reward');
    }

    // 7. Symbol/exchange validity: must be 'NSE' or 'BSE'
    if (setup.exchange !== 'NSE' && setup.exchange !== 'BSE') {
      reasons.push('invalid_symbol');
    }

    // 8. Optional SOIC Forensic Filter (Section 12 Blueprint)
    if (setup.soicForensics) {
      const { cfoToPatRatio, promoterPledgePct, hasPositiveFcf } = setup.soicForensics;
      if (
        (cfoToPatRatio != null && cfoToPatRatio < 0.70) ||
        (promoterPledgePct != null && promoterPledgePct > 20) ||
        (hasPositiveFcf === false)
      ) {
        reasons.push('soic_forensic_failure');
      }
    }

    // 9. Model calibration & overconfidence guard (Year 2 Governance)
    if (
      (setup.convictionScore > 85 && setup.isCalibrated === false) ||
      (setup.calibrationECE != null && setup.calibrationECE > 0.05)
    ) {
      reasons.push('overconfident_uncalibrated');
    }
  } catch {
    // If anything unexpected throws, return a catch-all failed result
    return {
      setupId: typeof setup?.id === 'string' ? setup.id : String(setup?.id ?? ''),
      passed: false,
      rejectionReasons: reasons.length > 0 ? reasons : ['invalid_symbol'],
    };
  }

  return {
    setupId: setup.id,
    passed: reasons.length === 0,
    rejectionReasons: reasons,
  };
}
