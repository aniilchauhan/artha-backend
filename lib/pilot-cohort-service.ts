/**
 * Axion Pilot Cohort Onboarding and Operating Cost Baseline Service
 * 
 * Satisfies Year 2 Backlog Q4:
 * "Prepare internal operating model for additional pilot cohorts, document feature roadmaps,
 * support, and cost baselines."
 */

export type CohortTier = 'COHORT_A_ADVISORY' | 'COHORT_B_QUANT' | 'COHORT_C_DERIVATIVES';

export interface PilotCohortDefinition {
  tier: CohortTier;
  name: string;
  description: string;
  maxUsers: number;
  currentUsers: number;
  entitledFeatures: string[];
  baseCostPerUserUsd: number;
}

export interface UnitEconomicsSummary {
  totalActiveUsers: number;
  monthlyInfraCostUsd: number;
  monthlyInfraCostInr: number;
  costPerUserUsd: number;
  costPerUserInr: number;
  cohortBreakdown: Record<CohortTier, { userCount: number; subtotalUsd: number }>;
}

const DEFAULT_COHORTS: Record<CohortTier, PilotCohortDefinition> = {
  COHORT_A_ADVISORY: {
    tier: 'COHORT_A_ADVISORY',
    name: 'Advisory Core Pilot',
    description: 'Fundamental research, real-time quotes, and AI market outlook.',
    maxUsers: 50,
    currentUsers: 35,
    entitledFeatures: ['quotes', 'watchlist', 'research', 'ai_chat'],
    baseCostPerUserUsd: 1.85,
  },
  COHORT_B_QUANT: {
    tier: 'COHORT_B_QUANT',
    name: 'Quantitative Screening & Paper Trading Pilot',
    description: 'Multi-factor screening, CAN SLIM models, and paper prediction ledger.',
    maxUsers: 50,
    currentUsers: 28,
    entitledFeatures: ['quotes', 'watchlist', 'research', 'ai_chat', 'screener', 'paper_portfolio', 'gap_engine'],
    baseCostPerUserUsd: 2.65,
  },
  COHORT_C_DERIVATIVES: {
    tier: 'COHORT_C_DERIVATIVES',
    name: 'Advanced Derivatives & Execution Pilot',
    description: 'Multi-leg options payoff engine, Greeks risk defense, and sandbox broker approvals.',
    maxUsers: 25,
    currentUsers: 12,
    entitledFeatures: ['quotes', 'watchlist', 'research', 'ai_chat', 'screener', 'paper_portfolio', 'gap_engine', 'options_greeks', 'broker_sandbox'],
    baseCostPerUserUsd: 3.40,
  },
};

class PilotCohortService {
  private cohorts: Record<CohortTier, PilotCohortDefinition> = JSON.parse(JSON.stringify(DEFAULT_COHORTS));
  private usdToInrRate = 84.0;

  public getCohort(tier: CohortTier): PilotCohortDefinition | null {
    return this.cohorts[tier] || null;
  }

  public getAllCohorts(): PilotCohortDefinition[] {
    return Object.values(this.cohorts);
  }

  public canAccessFeature(tier: CohortTier, feature: string): boolean {
    const cohort = this.cohorts[tier];
    if (!cohort) return false;
    return cohort.entitledFeatures.includes(feature);
  }

  public registerUser(tier: CohortTier): { success: boolean; error?: string } {
    const cohort = this.cohorts[tier];
    if (!cohort) return { success: false, error: `Cohort tier '${tier}' not found.` };
    if (cohort.currentUsers >= cohort.maxUsers) {
      return { success: false, error: `Cohort capacity reached (${cohort.currentUsers}/${cohort.maxUsers} users).` };
    }
    cohort.currentUsers++;
    return { success: true };
  }

  public computeUnitEconomics(): UnitEconomicsSummary {
    let totalUsers = 0;
    let totalCostUsd = 0;
    const breakdown: Record<CohortTier, { userCount: number; subtotalUsd: number }> = {
      COHORT_A_ADVISORY: { userCount: 0, subtotalUsd: 0 },
      COHORT_B_QUANT: { userCount: 0, subtotalUsd: 0 },
      COHORT_C_DERIVATIVES: { userCount: 0, subtotalUsd: 0 },
    };

    // Shared infrastructure base cost (MongoDB cluster, monitoring, static hosting): $79/mo
    const SHARED_INFRA_BASE_USD = 79.0;
    let variableCostUsd = 0;

    for (const [tier, cohort] of Object.entries(this.cohorts) as [CohortTier, PilotCohortDefinition][]) {
      const subtotal = cohort.currentUsers * cohort.baseCostPerUserUsd;
      totalUsers += cohort.currentUsers;
      variableCostUsd += subtotal;
      breakdown[tier] = {
        userCount: cohort.currentUsers,
        subtotalUsd: parseFloat(subtotal.toFixed(2)),
      };
    }

    totalCostUsd = SHARED_INFRA_BASE_USD + variableCostUsd;
    const costPerUserUsd = totalUsers > 0 ? totalCostUsd / totalUsers : 0;

    return {
      totalActiveUsers: totalUsers,
      monthlyInfraCostUsd: parseFloat(totalCostUsd.toFixed(2)),
      monthlyInfraCostInr: parseFloat((totalCostUsd * this.usdToInrRate).toFixed(2)),
      costPerUserUsd: parseFloat(costPerUserUsd.toFixed(2)),
      costPerUserInr: parseFloat((costPerUserUsd * this.usdToInrRate).toFixed(2)),
      cohortBreakdown: breakdown,
    };
  }
}

export const pilotCohortService = new PilotCohortService();
