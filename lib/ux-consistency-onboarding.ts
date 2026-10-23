/**
 * AX-31, AX-32, AX-33: Navigation Consistency, Multi-Strategy Disagreement & Onboarding
 *
 * Implements Sprint 11: "Make the core flow easy to use"
 *
 * Requirements:
 * AX-31 — Navigation:
 *   - Deep-link resolver and legacy route mappings ensuring zero broken bookmarks.
 *   - Core 6 destinations verification and mobile touch compliance check (min 44px tap targets).
 *
 * AX-32 — Consistency:
 *   - Multi-Strategy Disagreement Engine:
 *     If two strategies disagree (e.g., tactical 1–5d breakout vs 6–12m fundamental value),
 *     DO NOT collapse them into a fabricated universal buy/sell verdict.
 *     Present both strategies side-by-side with distinct horizons, criteria, and reasons.
 *
 * AX-33 — Onboarding:
 *   - Interactive tutorial model teaching:
 *     1. Data freshness inspection (detecting stale/missing quotes).
 *     2. Conditional entry triggers vs instant market buying.
 *     3. Sizing with 1% risk budget and 3-slot cap.
 *     4. "No qualifying stocks today" as a positive risk-mitigating outcome.
 *     5. Isolated educational sandbox data completely decoupled from live performance.
 */

// ---------------------------------------------------------------------------
// 1. Navigation & Deep-Link Resolver (AX-31)
// ---------------------------------------------------------------------------

export interface CoreDestination {
  id: string;
  name: string;
  path: string;
  purpose: string;
  emptyStateMeaning: string;
  ariaLabel: string;
}

export const CORE_SIX_DESTINATIONS: CoreDestination[] = [
  {
    id: 'today',
    name: 'Today',
    path: '/',
    purpose: 'Active market session overview, candidate setups, and review-due positions.',
    emptyStateMeaning: 'No qualifying setups passed strategy rules today. Capital is preserved.',
    ariaLabel: 'Today Market Terminal',
  },
  {
    id: 'stock-research',
    name: 'Stock Research',
    path: '/stock-ai',
    purpose: 'Audit technical metrics, corporate evidence, and separate short vs long assessments.',
    emptyStateMeaning: 'Missing financial filings yield incomplete assessment, never an invented thesis.',
    ariaLabel: 'Stock Evidence & Research',
  },
  {
    id: 'watchlist',
    name: 'Watchlist',
    path: '/watchlist',
    purpose: 'Track saved candidate setups with immutable signal references and countdowns.',
    emptyStateMeaning: 'No active candidates saved. Expired signals remain discoverable in history.',
    ariaLabel: 'Signal Watchlist',
  },
  {
    id: 'portfolio',
    name: 'Paper Portfolio',
    path: '/portfolio',
    purpose: 'Monitor accountable paper positions, cash balance, and session review deadlines.',
    emptyStateMeaning: 'All cash in reserve. 0 open positions.',
    ariaLabel: 'Paper Portfolio and Execution Ledger',
  },
  {
    id: 'results',
    name: 'Results',
    path: '/results',
    purpose: 'Inspect fully reconciled performance, win/loss stats, drawdown, and attrition funnel.',
    emptyStateMeaning: 'Zero trades recorded in selected window. No cherry-picked backtests.',
    ariaLabel: 'Strategy Performance Results and Funnel',
  },
  {
    id: 'data-health',
    name: 'Data Health',
    path: '/data-health',
    purpose: 'Inspect universe catalog, quote freshness, ingestion status, and worker heartbeat.',
    emptyStateMeaning: 'Operational health status nominal across all feeds.',
    ariaLabel: 'Data Infrastructure Health and Freshness',
  },
];

export const LEGACY_ROUTE_MAPPINGS: Record<string, { destination: string; label: string; isResearchLab: boolean }> = {
  '/rapid-moves': { destination: '/rapid-moves', label: '10% Move Radar (Experimental)', isResearchLab: true },
  '/swing-opportunities': { destination: '/swing-opportunities', label: 'Swing Setups (Experimental)', isResearchLab: true },
  '/frameworks': { destination: '/frameworks', label: 'Strategy Lab (Experimental)', isResearchLab: true },
  '/quant': { destination: '/quant', label: 'Quant Suite (Experimental)', isResearchLab: true },
  '/database': { destination: '/database', label: 'All Stocks Catalog', isResearchLab: false },
};

/**
 * Resolves a given path to its normalized destination and checks if it's within the 6 core journeys.
 */
export function resolveNavigationPath(path: string): {
  isCoreDestination: boolean;
  destination?: CoreDestination;
  legacyMapping?: { destination: string; label: string; isResearchLab: boolean };
} {
  const normalized = path.split('?')[0].split('#')[0];
  const core = CORE_SIX_DESTINATIONS.find(d => d.path === normalized);
  if (core) {
    return { isCoreDestination: true, destination: core };
  }

  const legacy = LEGACY_ROUTE_MAPPINGS[normalized];
  if (legacy) {
    return { isCoreDestination: false, legacyMapping: legacy };
  }

  return { isCoreDestination: false };
}

// ---------------------------------------------------------------------------
// 2. Multi-Strategy Disagreement Engine (AX-32)
// ---------------------------------------------------------------------------

export interface StrategyAssessment {
  strategyId: string;
  strategyName: string;
  version: string;
  horizon: '1-5 sessions' | '2-4 weeks' | '6-12 months' | 'multi-year';
  verdict: 'QUALIFIED_BUY_SETUP' | 'WATCHING_UNCONFIRMED' | 'CAUTION_NEUTRAL' | 'INVALIDATED_REJECT';
  keyMetric: string;
  observedValue: string | number;
  requiredThreshold: string;
  rationale: string;
}

export interface MultiStrategyConsensusReport {
  symbol: string;
  companyName: string;
  timestamp: string;
  strategies: StrategyAssessment[];
  hasDivergence: boolean;
  divergenceNotice?: string;
  unifiedVerdict: null; // INVARIANT: Must NEVER synthesize a single fake blended verdict
}

/**
 * Builds a multi-strategy assessment report.
 * AX-32 Invariant: Refuses to blend conflicting time horizons into a false consensus.
 */
export function evaluateMultiStrategyConsensus(
  symbol: string,
  companyName: string,
  assessments: StrategyAssessment[],
  timestamp: string
): MultiStrategyConsensusReport {
  if (assessments.length === 0) {
    throw new Error('At least one strategy assessment is required');
  }

  const verdicts = new Set(assessments.map(a => a.verdict));
  const hasDivergence = verdicts.size > 1;

  let divergenceNotice: string | undefined;
  if (hasDivergence) {
    const details = assessments.map(a => `${a.strategyName} (${a.horizon}): ${a.verdict}`).join(' vs ');
    divergenceNotice = `Strategy Divergence Detected [${details}]. Different time horizons and methodologies examine distinct properties. Axion presents individual strategy evidence side-by-side rather than collapsing them into an artificial single verdict.`;
  }

  return {
    symbol,
    companyName,
    timestamp,
    strategies: assessments,
    hasDivergence,
    divergenceNotice,
    unifiedVerdict: null, // Strictly null by design
  };
}

// ---------------------------------------------------------------------------
// 3. User Onboarding & Educational Sandbox (AX-33)
// ---------------------------------------------------------------------------

export interface OnboardingStep {
  stepIndex: number;
  title: string;
  objective: string;
  conceptExplained: string;
  interactiveChallenge: {
    question: string;
    options: { text: string; isCorrect: boolean; explanation: string }[];
  };
}

export const ONBOARDING_CURRICULUM: OnboardingStep[] = [
  {
    stepIndex: 1,
    title: 'Data Freshness & Quote Age',
    objective: 'Learn how to detect stale data and why Axion will not make recommendations on unverified quotes.',
    conceptExplained:
      'A quote older than 15 minutes during active sessions is marked STALE. Risk calculations become UNCERTAIN to protect you from making decisions on outdated information.',
    interactiveChallenge: {
      question: 'A stock quote was last updated 42 minutes ago during active market hours. What does Axion do?',
      options: [
        {
          text: 'Proceeds with trade recommendations assuming price hasn’t moved much.',
          isCorrect: false,
          explanation: 'Incorrect. Unverified quotes carry high risk of slippage.',
        },
        {
          text: 'Marks status as UNCERTAIN, displays a stale quote warning, and halts automatic fills.',
          isCorrect: true,
          explanation: 'Correct! Axion prioritizes data integrity and transparent uncertainty.',
        },
      ],
    },
  },
  {
    stepIndex: 2,
    title: 'Conditional Trigger vs Market Order',
    objective: 'Understand why setups specify an entry trigger instead of buying immediately.',
    conceptExplained:
      'A breakout trade is only valid once the price crosses resistance + buffer (the trigger). If price never crosses the trigger, no capital is risked.',
    interactiveChallenge: {
      question: 'Stock is currently trading at ₹100. Resistance is ₹102, and planned trigger is ₹102.25. What is the correct action?',
      options: [
        {
          text: 'Buy immediately at ₹100 because it is cheaper.',
          isCorrect: false,
          explanation: 'Incorrect. If it fails to break resistance, it may reverse downwards.',
        },
        {
          text: 'Watch and wait. Only enter if price trades above ₹102.25 with volume.',
          isCorrect: true,
          explanation: 'Correct! Waiting for confirmation is the core rule of AX-STRAT-01.',
        },
      ],
    },
  },
  {
    stepIndex: 3,
    title: 'Whole-Share Sizing & 1% Risk Budget',
    objective: 'Understand the arithmetic of capital preservation.',
    conceptExplained:
      'On a ₹50,000 portfolio, 1% risk equals ₹500 max planned loss. Axion divides capital into 3 slots (₹16,666 each) and rounds down to whole shares.',
    interactiveChallenge: {
      question: 'Risk budget permits 15 shares, but available capital slot only permits 10 whole shares. How many shares are proposed?',
      options: [
        {
          text: '10 shares (the smaller, conservative constraint).',
          isCorrect: true,
          explanation: 'Correct! Risk and capital limits enforce the most conservative bound.',
        },
        {
          text: '15 shares using margin or borrowed funds.',
          isCorrect: false,
          explanation: 'Incorrect. Axion is strictly cash equity without unauthorized leverage.',
        },
      ],
    },
  },
  {
    stepIndex: 4,
    title: 'Why "No Candidates Today" is a Win',
    objective: 'Understand the discipline of cash preservation.',
    conceptExplained:
      'When market conditions do not provide high-probability setups, standing aside in cash is an active and successful risk decision.',
    interactiveChallenge: {
      question: 'Today the scanner found 0 qualifying stocks out of 500 screened. What happened?',
      options: [
        {
          text: 'The platform malfunctioned or failed.',
          isCorrect: false,
          explanation: 'Incorrect. A clean scan that finds zero qualifying stocks is completely normal.',
        },
        {
          text: 'Strategy rules disciplined capital. No setups met criteria, so 100% cash is preserved.',
          isCorrect: true,
          explanation: 'Correct! Capital preservation during unsupportive markets is essential.',
        },
      ],
    },
  },
];

/**
 * Validates a user response in the onboarding tutorial.
 */
export function evaluateOnboardingAnswer(
  stepIndex: number,
  selectedOptionIndex: number
): { isCorrect: boolean; feedback: string } {
  const step = ONBOARDING_CURRICULUM.find(s => s.stepIndex === stepIndex);
  if (!step) {
    throw new Error(`Invalid onboarding step: ${stepIndex}`);
  }

  const option = step.interactiveChallenge.options[selectedOptionIndex];
  if (!option) {
    throw new Error(`Invalid option index: ${selectedOptionIndex}`);
  }

  return {
    isCorrect: option.isCorrect,
    feedback: option.explanation,
  };
}
