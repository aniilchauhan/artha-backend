/**
 * Axion Year 3 Expansion Readiness Evaluator
 * 
 * Satisfies Year 2 Backlog Q4 & Section 6:
 * "Evaluate Year 3 readiness for selective expansion. Year 2 success depends on:
 *  1. Release-readiness process and support model,
 *  2. Measurable model calibration discipline (ECE <= 5.0%),
 *  3. Operational telemetry and restore assurance,
 *  4. Core workflow parity across web and mobile,
 *  5. Clear difference between advisory and execution approvals."
 */

export interface ReadinessGateItem {
  id: string;
  name: string;
  category: 'GOVERNANCE' | 'ML_TRUST' | 'OPERATIONS' | 'CLIENT_PARITY' | 'EXECUTION_SAFETY';
  targetCriteria: string;
  observedStatus: string;
  passed: boolean;
}

export interface YearThreeReadinessReport {
  evaluatedAt: string;
  readinessScore: number; // 0 to 100
  allGatesPassed: boolean;
  decision: 'PROCEED_TO_YEAR_3_SELECTIVE_EXPANSION' | 'DEFER_EXPANSION_PRESERVE_QUALITY';
  gates: ReadinessGateItem[];
  executiveSummary: string;
}

export interface SystemAuditInput {
  hasSupportRunbook: boolean;
  currentECE: number; // e.g. 0.042 (4.2%)
  isTruncationActive: boolean;
  latestRestoreDrillStatus: 'PASSED' | 'FAILED' | 'NONE';
  latencyBreached: boolean;
  mobileParityVerified: boolean;
  isTwoPhaseApprovalActive: boolean;
  isLiveBrokerDirectExecutionBlocked: boolean; // Must be true per Year 2 boundary
}

/**
 * Evaluates platform audit telemetry against the 5 Year 3 Preconditions for Success.
 */
export function evaluateYearThreeReadiness(audit: SystemAuditInput): YearThreeReadinessReport {
  const gates: ReadinessGateItem[] = [
    // Gate 1: Release-readiness and support model
    {
      id: 'gate_1_support_model',
      name: 'Release-Readiness & Support Workflow',
      category: 'GOVERNANCE',
      targetCriteria: 'Documented triage runbook, incident classification matrix, and diagnostic CLI',
      observedStatus: audit.hasSupportRunbook
        ? 'INCIDENT_TRIAGE_RUNBOOK.md and diagnose-system.mjs active'
        : 'Missing runbooks or diagnostic tooling',
      passed: audit.hasSupportRunbook,
    },

    // Gate 2: Measurable model calibration discipline
    {
      id: 'gate_2_calibration_discipline',
      name: 'Model Calibration & Conflict Detection',
      category: 'ML_TRUST',
      targetCriteria: 'ECE <= 5.0%, temperature scaling / isotonic mapping, 85% confidence truncation',
      observedStatus: audit.currentECE <= 0.05 && audit.isTruncationActive
        ? `ECE ${(audit.currentECE * 100).toFixed(1)}% satisfies <= 5.0% threshold with confidence truncation`
        : `ECE ${(audit.currentECE * 100).toFixed(1)}% exceeds threshold or truncation inactive`,
      passed: audit.currentECE <= 0.05 && audit.isTruncationActive,
    },

    // Gate 3: Operational telemetry and restore assurance
    {
      id: 'gate_3_restore_assurance',
      name: 'Operational Telemetry & Restore Assurance',
      category: 'OPERATIONS',
      targetCriteria: 'Automated restore drill PASSED with 0% corruption, latency within SLA budgets',
      observedStatus: audit.latestRestoreDrillStatus === 'PASSED' && !audit.latencyBreached
        ? 'Restore drill PASSED, latency percentiles healthy across all endpoints'
        : `Restore drill: ${audit.latestRestoreDrillStatus}, Latency breach: ${audit.latencyBreached}`,
      passed: audit.latestRestoreDrillStatus === 'PASSED' && !audit.latencyBreached,
    },

    // Gate 4: Web and Mobile workflow parity
    {
      id: 'gate_4_workflow_parity',
      name: 'Web and Mobile Parity for Core Journeys',
      category: 'CLIENT_PARITY',
      targetCriteria: 'Cross-platform auth sync, watchlist parity, offline state caching verified by test suite',
      observedStatus: audit.mobileParityVerified
        ? 'Mobile test suite passes Essential Journeys 1, 2, and 3 with offline fallback'
        : 'Mobile parity tests unverified or failing',
      passed: audit.mobileParityVerified,
    },

    // Gate 5: Execution safety and approval separation
    {
      id: 'gate_5_execution_safety',
      name: 'Advisory vs Execution Boundary',
      category: 'EXECUTION_SAFETY',
      targetCriteria: 'Two-phase approval state machine, anti-replay ledger, direct live broker execution blocked',
      observedStatus: audit.isTwoPhaseApprovalActive && audit.isLiveBrokerDirectExecutionBlocked
        ? 'Two-phase approval active, sandbox-first execution enforced, direct public broker orders barred'
        : 'Execution approval layers incomplete or live direct execution enabled prematurely',
      passed: audit.isTwoPhaseApprovalActive && audit.isLiveBrokerDirectExecutionBlocked,
    },
  ];

  const passedCount = gates.filter(g => g.passed).length;
  const readinessScore = Math.round((passedCount / gates.length) * 100);
  const allGatesPassed = passedCount === gates.length;

  const decision = allGatesPassed
    ? 'PROCEED_TO_YEAR_3_SELECTIVE_EXPANSION'
    : 'DEFER_EXPANSION_PRESERVE_QUALITY';

  const executiveSummary = allGatesPassed
    ? 'All 5 preconditions for Year 3 expansion are verified. Platform demonstrates calibration quality, restore assurance, and strict execution governance.'
    : `Expansion deferred (${passedCount}/${gates.length} gates passed). Retain platform in advisory/paper-trading mode to preserve operational quality.`;

  return {
    evaluatedAt: new Date().toISOString(),
    readinessScore,
    allGatesPassed,
    decision,
    gates,
    executiveSummary,
  };
}
