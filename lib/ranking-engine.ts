import type { SetupInput } from './quality-gate';

export interface RankingInputs {
  momentum: number | null;           // 0–100
  relativeStrength: number | null;   // 0–100
  qualityFundamentals: number | null;
  valuation: number | null;
  trendAlignment: number | null;
  catalystQuality: number | null;
  riskRewardRatio: number;
  marketRegimeFit: number | null;
}

export interface SetupForRanking {
  id: string;
  setup: SetupInput;
  rankingInputs: RankingInputs;
}

export interface RankedSetup {
  setupId: string;
  setupScore: number;          // 0–100
  rank: number;                // 1-indexed
  rejected: boolean;
  rejectionReason?: 'below_minimum_score';
  substitutedInputs: Array<keyof RankingInputs>;
}

export interface RankedSetupList {
  setups: RankedSetup[];
}

export const RANKING_WEIGHTS: Record<keyof RankingInputs, number> = {
  momentum:             0.15,
  relativeStrength:     0.15,
  qualityFundamentals:  0.15,
  valuation:            0.10,
  trendAlignment:       0.15,
  catalystQuality:      0.10,
  riskRewardRatio:      0.15,
  marketRegimeFit:      0.05,
};

const NEUTRAL_SCORE = 50;
const MIN_SCORE_THRESHOLD = 40;

/**
 * Ranks a list of setups by computing a weighted composite score.
 * - Null inputs are substituted with a neutral score of 50.
 * - Setups scoring below 40 are marked rejected.
 * - Results are sorted descending by score; ties broken by higher riskRewardRatio.
 * - Ranks are assigned 1-indexed with no gaps.
 */
export function rankSetups(setups: SetupForRanking[]): RankedSetupList {
  if (setups.length === 0) {
    return { setups: [] };
  }

  // Score each setup
  const scored = setups.map((s) => {
    const inputs = s.rankingInputs;
    const substitutedInputs: Array<keyof RankingInputs> = [];

    // Resolve each input, substituting null with neutral score
    const resolved: Record<keyof RankingInputs, number> = {
      momentum:             resolveInput(inputs.momentum, 'momentum', substitutedInputs),
      relativeStrength:     resolveInput(inputs.relativeStrength, 'relativeStrength', substitutedInputs),
      qualityFundamentals:  resolveInput(inputs.qualityFundamentals, 'qualityFundamentals', substitutedInputs),
      valuation:            resolveInput(inputs.valuation, 'valuation', substitutedInputs),
      trendAlignment:       resolveInput(inputs.trendAlignment, 'trendAlignment', substitutedInputs),
      catalystQuality:      resolveInput(inputs.catalystQuality, 'catalystQuality', substitutedInputs),
      riskRewardRatio:      resolveInput(inputs.riskRewardRatio, 'riskRewardRatio', substitutedInputs),
      marketRegimeFit:      resolveInput(inputs.marketRegimeFit, 'marketRegimeFit', substitutedInputs),
    };

    // Compute weighted score
    let rawScore = 0;
    for (const key of Object.keys(RANKING_WEIGHTS) as Array<keyof RankingInputs>) {
      rawScore += resolved[key] * RANKING_WEIGHTS[key];
    }

    // Clamp to [0, 100]
    const setupScore = Math.min(100, Math.max(0, rawScore));

    const rejected = setupScore < MIN_SCORE_THRESHOLD;

    return {
      setupId: s.id,
      setupScore,
      riskRewardRatio: inputs.riskRewardRatio,  // for tie-breaking
      rejected,
      rejectionReason: rejected ? ('below_minimum_score' as const) : undefined,
      substitutedInputs,
    };
  });

  // Sort descending by score; break ties by higher riskRewardRatio
  scored.sort((a, b) => {
    if (b.setupScore !== a.setupScore) {
      return b.setupScore - a.setupScore;
    }
    return (b.riskRewardRatio ?? 0) - (a.riskRewardRatio ?? 0);
  });

  // Assign 1-indexed contiguous ranks
  const result: RankedSetup[] = scored.map((s, i) => ({
    setupId: s.setupId,
    setupScore: s.setupScore,
    rank: i + 1,
    rejected: s.rejected,
    ...(s.rejectionReason ? { rejectionReason: s.rejectionReason } : {}),
    substitutedInputs: s.substitutedInputs,
  }));

  return { setups: result };
}

function resolveInput(
  value: number | null | undefined,
  key: keyof RankingInputs,
  substituted: Array<keyof RankingInputs>
): number {
  if (value === null || value === undefined) {
    substituted.push(key);
    return NEUTRAL_SCORE;
  }
  return value;
}
