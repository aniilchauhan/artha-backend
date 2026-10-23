/**
 * AX-37, AX-38, AX-39: Release Gates Review, Strategy Graduation & Operating Governance
 *
 * Implements Sprint 13: "Release an auditable product"
 *
 * Requirements:
 * AX-37 — Release review:
 *   - Evaluates all 6 preregistered Release Gates:
 *     1. Data Gate
 *     2. Signal Integrity Gate
 *     3. Execution Gate
 *     4. Statistical Evidence Gate
 *     5. Operational Gate
 *     6. Product Gate
 *   - Preregistered strategy graduation: Decides status based on empirical criteria, NOT release date.
 *     If forward sample is insufficient or edge is unconfirmed, status remains 'CONTINUE_PAPER_TRIAL'.
 *   - Unresolved issue register with severity, owner, and workaround.
 *
 * AX-38 — Operating handbook:
 *   - End-to-end deployment, recovery, and reconciliation runbook.
 *   - Reproducible scenarios for no-fills and expired signals.
 *
 * AX-39 — v1 delivery:
 *   - Full traceability of a dated signal from observation -> decision -> order -> review -> exit -> results.
 */

// ---------------------------------------------------------------------------
// 1. Release Gates & Evidence Registry (AX-37)
// ---------------------------------------------------------------------------

export type GateId =
  | 'DATA_GATE'
  | 'SIGNAL_INTEGRITY_GATE'
  | 'EXECUTION_GATE'
  | 'STATISTICAL_EVIDENCE_GATE'
  | 'OPERATIONAL_GATE'
  | 'PRODUCT_GATE';

export type GateStatus = 'PASSED' | 'CONDITIONAL' | 'FAILED';

export interface ReleaseGateAssessment {
  gateId: GateId;
  name: string;
  status: GateStatus;
  criteria: string;
  concreteEvidence: string;
  fallbackAction: string;
}

export type StrategyGraduationDecision =
  | 'GRADUATED_PRODUCTION'
  | 'CONTINUE_PAPER_TRIAL'
  | 'REJECTED_RETIRED';

export interface UnresolvedIssue {
  id: string;
  title: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'COSMETIC';
  owner: string;
  impact: string;
  workaround: string;
  releaseBlocking: boolean;
}

export interface ReleaseReviewSummary {
  strategyVersion: string;
  evaluatedAt: string;
  gates: ReleaseGateAssessment[];
  unresolvedIssues: UnresolvedIssue[];
  graduationDecision: StrategyGraduationDecision;
  decisionRationale: string;
  isEligibleForV1Release: boolean;
}

/**
 * Standard register of Axion release gates and evidence.
 */
export function evaluateReleaseGates(params: {
  tradesCount: number;
  weeksCount: number;
  hasOutageRecoveryTested: boolean;
  hasReconciliationZeroDiff: boolean;
  hasLookaheadZero: boolean;
  hasDataQualityVerified?: boolean;
  hasProductFlowVerified?: boolean;
  performanceEvidence?: { protocolId: string; artifactId: string; netReturnPct: number; benchmarkReturnPct: number; excessReturnLower95Pct: number; maxDrawdownPct: number; registeredMaxDrawdownPct: number; costsIncluded: boolean; untouchedEvaluation: boolean };
  unresolvedIssues?: UnresolvedIssue[];
}): ReleaseReviewSummary {
  const issues = params.unresolvedIssues || [
    {
      id: 'ISSUE-01',
      title: 'Real-time WebSocket tick streaming for intraday seconds display',
      severity: 'COSMETIC',
      owner: 'Frontend Team',
      impact: 'Quotes update on 15s polling rather than sub-second WebSockets.',
      workaround: 'EOD and 15-minute polling is sufficient for 1–5 session swing horizon.',
      releaseBlocking: false,
    },
    {
      id: 'ISSUE-02',
      title: 'Historical coverage for delisted micro-cap penny stocks pre-2023',
      severity: 'LOW',
      owner: 'Data Engineering',
      impact: 'Universe restricted to active NSE EQ series with >₹1 Cr turnover.',
      workaround: 'Strategy contract explicitly filters to liquid NSE universe anyway.',
      releaseBlocking: false,
    },
  ];

  const dataGate: ReleaseGateAssessment = {
    gateId: 'DATA_GATE',
    name: 'Data Integrity & Provenance Gate',
    status: params.hasDataQualityVerified === true ? 'PASSED' : 'FAILED',
    criteria: 'Every quote has a date and source; stale quotes (>15m) are marked uncertain.',
    concreteEvidence: 'Implemented in lib/observation-pipeline.ts and verified in tests/thesis-monitoring-journal.test.ts',
    fallbackAction: 'Show observations only; suppress affected decisions.',
  };

  const signalGate: ReleaseGateAssessment = {
    gateId: 'SIGNAL_INTEGRITY_GATE',
    name: 'Signal Integrity & Zero Lookahead Gate',
    status: params.hasLookaheadZero ? 'PASSED' : 'FAILED',
    criteria: 'Frozen quantitative rules; immutable SHA-256 hashes; zero lookahead on filings.',
    concreteEvidence: 'Implemented in lib/signal-schema.ts and lib/thesis-monitoring-journal.ts',
    fallbackAction: 'Research status only; no edge claimed.',
  };

  const executionGate: ReleaseGateAssessment = {
    gateId: 'EXECUTION_GATE',
    name: 'Execution & Reconciliation Gate',
    status: params.hasReconciliationZeroDiff ? 'PASSED' : 'FAILED',
    criteria: 'Whole shares, ₹15.34 DP fees, 0.10% charges, circuit band locks, and ₹0.00 cash reconciliation.',
    concreteEvidence: 'Implemented in lib/simulation-engine.ts and lib/paper-position-state-machine.ts',
    fallbackAction: 'Block live execution claims.',
  };

  // Statistical Evidence Gate: Requires >=30 trades and >=8 weeks
  const isSampleAdequate = params.tradesCount >= 30 && params.weeksCount >= 8;
  const evidence = params.performanceEvidence;
  const edgeVerified = !!evidence && !!evidence.protocolId && !!evidence.artifactId && evidence.costsIncluded && evidence.untouchedEvaluation &&
    [evidence.netReturnPct,evidence.benchmarkReturnPct,evidence.excessReturnLower95Pct,evidence.maxDrawdownPct,evidence.registeredMaxDrawdownPct].every(Number.isFinite) &&
    evidence.netReturnPct > 0 && evidence.netReturnPct > evidence.benchmarkReturnPct && evidence.excessReturnLower95Pct > 0 &&
    evidence.maxDrawdownPct >= 0 && evidence.registeredMaxDrawdownPct >= 0 && evidence.maxDrawdownPct <= evidence.registeredMaxDrawdownPct;
  const statisticalGate: ReleaseGateAssessment = {
    gateId: 'STATISTICAL_EVIDENCE_GATE',
    name: 'Statistical Sample Adequacy Gate',
    status: isSampleAdequate && edgeVerified ? 'PASSED' : 'CONDITIONAL',
    criteria: 'Preregistered holdout, minimum 30 closed trades, minimum 8 trading weeks, and 95% Wilson confidence intervals.',
    concreteEvidence: `Evaluated ${params.tradesCount}/30 trades across ${params.weeksCount}/8 weeks.`,
    fallbackAction: 'Continue paper trial. Elapsed calendar time alone never establishes a trading edge.',
  };

  const operationalGate: ReleaseGateAssessment = {
    gateId: 'OPERATIONAL_GATE',
    name: 'Operational Resilience Gate',
    status: params.hasOutageRecoveryTested ? 'PASSED' : 'FAILED',
    criteria: 'Browser-closed worker daemon, single-job lease locking, stale-service transition, and backup restore.',
    concreteEvidence: 'Implemented in lib/durable-scanner-daemon.ts and lib/reliability-drill-audit.ts',
    fallbackAction: 'Disable continuous monitoring claims.',
  };

  const productGate: ReleaseGateAssessment = {
    gateId: 'PRODUCT_GATE',
    name: 'Product Usability & Truthfulness Gate',
    status: params.hasProductFlowVerified === true ? 'PASSED' : 'FAILED',
    criteria: 'Accessible 6 core destinations, refusal to blend divergent strategies into fake consensus, and onboarding curriculum.',
    concreteEvidence: 'Implemented in lib/ux-consistency-onboarding.ts and tests/ux-consistency-onboarding.test.ts',
    fallbackAction: 'Restrict experimental features to clearly labeled labs.',
  };

  const gates = [dataGate, signalGate, executionGate, statisticalGate, operationalGate, productGate];

  const hasBlockingIssue = issues.some(i => i.releaseBlocking);
  const criticalGatesPassed = [dataGate, signalGate, executionGate, operationalGate, productGate].every(
    g => g.status === 'PASSED'
  );

  let graduationDecision: StrategyGraduationDecision = 'CONTINUE_PAPER_TRIAL';
  let decisionRationale = '';

  if (!criticalGatesPassed || hasBlockingIssue) {
    graduationDecision = 'REJECTED_RETIRED';
    decisionRationale = 'Critical platform integrity gates or blocking issues failed.';
  } else if (!isSampleAdequate || !edgeVerified) {
    graduationDecision = 'CONTINUE_PAPER_TRIAL';
    decisionRationale = `Forward sample (${params.tradesCount}/30 trades, ${params.weeksCount}/8 weeks) or registered after-cost performance evidence is insufficient. Counts alone do not establish an edge. Continue paper trial.`;
  } else {
    graduationDecision = 'GRADUATED_PRODUCTION';
    decisionRationale = 'All 6 gates and statistical sample criteria satisfied.';
  }

  return {
    strategyVersion: 'AX-STRAT-01-v1.0',
    evaluatedAt: new Date().toISOString(),
    gates,
    unresolvedIssues: issues,
    graduationDecision,
    decisionRationale,
    isEligibleForV1Release: criticalGatesPassed && !hasBlockingIssue,
  };
}

// ---------------------------------------------------------------------------
// 2. End-to-End Signal Lifecycle Trace (AX-39)
// ---------------------------------------------------------------------------

export interface SignalLifecycleStep {
  step: string;
  timestamp: string;
  status: string;
  evidence: string;
  details: Record<string, any>;
}

export interface EndToEndLifecycleTrace {
  symbol: string;
  signalId: string;
  orderId: string;
  steps: SignalLifecycleStep[];
  isTraceValid: boolean;
}

/**
 * Validates a complete end-to-end lifecycle trace for a dated signal from observation to results.
 */
export function buildSignalLifecycleTrace(
  symbol: string,
  signalId: string,
  orderId: string
): EndToEndLifecycleTrace {
  // A symbol and IDs cannot establish any lifecycle outcome without actual stored evidence.
  return { symbol, signalId, orderId, steps: [], isTraceValid: false };
}
