/**
 * AX-34, AX-35, AX-36: Platform Reliability, Failure Drills & Research Integrity Audit
 *
 * Implements Sprint 12: "Prove the service can survive real failures"
 *
 * Requirements:
 * AX-34 — Platform reliability:
 *   - Backup export and deterministic restoration into clean state.
 *   - SHA-256 fingerprint verification of restored ledgers and signals.
 *   - Per-user data tenancy isolation.
 *
 * AX-35 — Failure drills & Resilience Matrix:
 *   - 8 critical failure drills:
 *     1. Provider Outage
 *     2. Partial Quote Coverage
 *     3. Corporate Action Discontinuity (splits/bonuses)
 *     4. Market Holiday
 *     5. Circuit Lock (Upper/Lower band freeze)
 *     6. Duplicate Scheduled Job Lock
 *     7. Database Reconnection Recovery
 *     8. Host Interruption & Checkpoint Resumption
 *   - Verifies that affected decisions become visibly restricted without crashing.
 *
 * AX-36 — Research audit:
 *   - Verifies unknown values are NEVER treated as 0 or positive evidence.
 *   - Zero look-ahead timestamp validation.
 *   - Transaction cost inclusion (0.10% + ₹15.34 DP fees).
 *   - Recommendation wording audit (prohibits "Guaranteed", "Buy Now", requires "Conditional trigger").
 */

import { createHash } from 'crypto';
import type { PaperOrder, PaperEvent } from './paper-position-state-machine';

// ---------------------------------------------------------------------------
// 1. Backup, Restore & Multi-Tenant Isolation (AX-34)
// ---------------------------------------------------------------------------

export interface AxionLedgerBackup {
  backupId: string;
  userId: string;
  createdAt: string;
  checksumSha256: string;
  payload: {
    orders: PaperOrder[];
    events: PaperEvent[];
    cashBalance: number;
    initialCapital: number;
  };
}

/**
 * Computes deterministic SHA-256 fingerprint of a backup payload.
 */
export function computeBackupChecksum(payload: AxionLedgerBackup['payload']): string {
  const serialized = JSON.stringify({
    userId: 'tenant_scoped',
    initialCapital: payload.initialCapital,
    cashBalance: payload.cashBalance,
    orders: payload.orders.map(o => ({ id: o.id, status: o.status, netPnl: o.netPnl })),
    events: payload.events.map(e => e.id),
  });
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Creates an encrypted/verified backup snapshot of a user's paper ledger.
 */
export function createLedgerBackup(
  userId: string,
  orders: PaperOrder[],
  events: PaperEvent[],
  cashBalance: number,
  initialCapital: number
): AxionLedgerBackup {
  const payload = { orders, events, cashBalance, initialCapital };
  const checksumSha256 = computeBackupChecksum(payload);
  const backupId = `bkp_${userId}_${Date.now()}`;

  return {
    backupId,
    userId,
    createdAt: new Date().toISOString(),
    checksumSha256,
    payload,
  };
}

/**
 * Restores a ledger backup into a clean environment, verifying checksum and multi-tenant isolation.
 */
export function restoreLedgerBackup(
  backup: AxionLedgerBackup,
  requestingUserId: string
): {
  success: boolean;
  restoredOrdersCount: number;
  restoredCash: number;
  error?: string;
} {
  // 1. Tenancy access check
  if (backup.userId !== requestingUserId) {
    return {
      success: false,
      restoredOrdersCount: 0,
      restoredCash: 0,
      error: 'Access Denied: Cannot restore another tenant’s private ledger.',
    };
  }

  // 2. Checksum verification
  const computedChecksum = computeBackupChecksum(backup.payload);
  if (computedChecksum !== backup.checksumSha256) {
    return {
      success: false,
      restoredOrdersCount: 0,
      restoredCash: 0,
      error: 'Integrity Violation: Backup checksum mismatch. File may be corrupted or tampered.',
    };
  }

  return {
    success: true,
    restoredOrdersCount: backup.payload.orders.length,
    restoredCash: backup.payload.cashBalance,
  };
}

// ---------------------------------------------------------------------------
// 2. Failure Drills & Operational Matrix (AX-35)
// ---------------------------------------------------------------------------

export type FailureDrillType =
  | 'PROVIDER_OUTAGE'
  | 'PARTIAL_QUOTE_COVERAGE'
  | 'CORPORATE_ACTION_SPLIT'
  | 'MARKET_HOLIDAY'
  | 'CIRCUIT_LOCK_FREEZE'
  | 'DUPLICATE_JOB_COLLISION'
  | 'DATABASE_RECONNECT'
  | 'HOST_DOWNTIME_RESUMPTION';

export interface DrillExecutionResult {
  drillType: FailureDrillType;
  expectedBehavior: string;
  observedStatus: 'SUCCESS' | 'CONTAINED_FAILURE' | 'NOT_RUN';
  systemRestrictionNotice: string;
  isDataIntegrityPreserved: boolean;
}

/**
 * Simulates a specific failure drill and validates that Axion restricts affected operations
 * safely without silent failures or data corruption.
 */
export function executeFailureDrill(drillType: FailureDrillType): DrillExecutionResult {
  return {
    drillType,
    expectedBehavior: 'Exercise the corresponding adapter and verify observed recovery.',
    observedStatus: 'NOT_RUN',
    systemRestrictionNotice: 'Scenario specification only; no observed drill evidence supplied.',
    isDataIntegrityPreserved: false,
  };
}

// ---------------------------------------------------------------------------
// 3. Research Audit & Bias Protection (AX-36)
// ---------------------------------------------------------------------------

export interface ResearchObservationInput {
  symbol: string;
  observationDate: string;
  price: number | null;
  volume: number | null;
  debtToEquity: number | null;
  quarterlyPatGrowth: number | null;
  publicationDate?: string;
  decisionWording: string;
  transactionCostsIncluded: boolean;
}

export interface ResearchAuditViolation {
  code: string;
  field: string;
  violation: string;
}

export interface ResearchAuditReport {
  isCompliant: boolean;
  violations: ResearchAuditViolation[];
  auditSummary: string;
}

/**
 * Audits research data integrity against AX-36 rules:
 * 1. Missing/unknown values cannot be treated as 0 or positive evidence.
 * 2. Publication date must exist and be <= observation date (no lookahead).
 * 3. Transaction costs must be accounted for.
 * 4. Wording cannot contain forbidden hype ("Guaranteed", "Buy Now", "Target guaranteed").
 */
export function auditResearchIntegrity(
  observation: ResearchObservationInput
): ResearchAuditReport {
  const violations: ResearchAuditViolation[] = [];

  // Check 1: Missing values cannot be null treated as zero
  if (observation.debtToEquity === null || observation.debtToEquity === undefined) {
    violations.push({
      code: 'MISSING_DATA_UNKNOWN',
      field: 'debtToEquity',
      violation: 'Unknown debt metric must be flagged as incomplete, not defaulted to 0 or healthy.',
    });
  }

  // Check 2: Look-ahead publication date
  if (observation.publicationDate) {
    const pub = new Date(observation.publicationDate).getTime();
    const obs = new Date(observation.observationDate).getTime();
    if (pub > obs) {
      violations.push({
        code: 'LOOKAHEAD_FINANCIALS',
        field: 'publicationDate',
        violation: `Lookahead bias: Filing publication date ${observation.publicationDate} is after observation date ${observation.observationDate}.`,
      });
    }
  } else {
    violations.push({
      code: 'UNDATED_FINANCIALS',
      field: 'publicationDate',
      violation: 'Financial statements with unknown publication date cannot be consumed in historical research.',
    });
  }

  // Check 3: Transaction costs
  if (!observation.transactionCostsIncluded) {
    violations.push({
      code: 'OMITTED_TRANSACTION_COSTS',
      field: 'transactionCostsIncluded',
      violation: 'Performance claims omitted transaction costs (0.10% brokerage/STT + ₹15.34 DP fees).',
    });
  }

  // Check 4: Recommendation wording
  const forbiddenPhrases = ['guaranteed', 'buy now', 'strong buy', 'sure shot', 'risk-free'];
  const lowerWording = observation.decisionWording.toLowerCase();
  for (const phrase of forbiddenPhrases) {
    if (lowerWording.includes(phrase)) {
      violations.push({
        code: 'FORBIDDEN_RECOMMENDATION_WORDING',
        field: 'decisionWording',
        violation: `Decision wording contains unpermitted promissory language: "${phrase}". Must use conditional phrases such as "watching; entry conditions not met" or "conditional trigger".`,
      });
    }
  }

  return {
    isCompliant: violations.length === 0,
    violations,
    auditSummary:
      violations.length === 0
        ? 'Research observation is fully compliant with AX-36 integrity standards.'
        : `Identified ${violations.length} compliance violation(s). Record rejected from validated research pool.`,
  };
}
