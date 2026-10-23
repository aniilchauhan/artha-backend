/**
 * AX-25, AX-26, AX-27: Position Monitoring, Company Events & Thesis Review Journal
 *
 * Implements Sprint 9: "Monitor the thesis, not only the price"
 *
 * Requirements:
 * AX-25 — Position monitoring:
 *   - Current position state, dated quote, original entry thesis, net estimated P&L,
 *     target/invalidation distance, and next review.
 *   - Uses exchange sessions for time-based review rather than naive calendar-day subtraction.
 *   - Stale quote makes current status uncertain instead of falsely reassuring.
 *
 * AX-26 — Company events:
 *   - Ingests dated quarterly results and material announcements with source link and instrument identity.
 *   - Strictly distinguishes eventTime, publicationTime, and ingestionTime.
 *   - Summaries identify facts that changed; unsupported impact claims are forbidden.
 *   - Guarantees look-ahead safety: event cannot be used historically prior to publicationTime.
 *
 * AX-27 — Hold journal:
 *   - Records continue-review, reduce-paper-exposure, or close-paper-position decisions with dated evidence.
 *   - Identifies thesis-breaking conditions (fundamental shifts) separately from short-term price triggers.
 *   - Explicitly records when human review is required due to incomplete facts.
 *   - Anti-drift guard: A declining price or expired time horizon cannot silently morph into a long-term hold.
 */

import type { PaperOrder } from './paper-position-state-machine';

// ---------------------------------------------------------------------------
// 1. Exchange Session Calendar & Timing (AX-25)
// ---------------------------------------------------------------------------

export const DEFAULT_NSE_HOLIDAYS_2026_2027: string[] = [
  '2026-10-02', // Gandhi Jayanti
  '2026-10-20', // Dussehra
  '2026-11-09', // Diwali Laxmi Pujan
  '2026-11-10', // Diwali Balipratipada
  '2026-11-24', // Guru Nanak Jayanti
  '2026-12-25', // Christmas
  '2027-01-26', // Republic Day
  '2027-03-08', // Mahashivratri
  '2027-03-24', // Holi
  '2027-03-26', // Good Friday
];

/**
 * Checks if a given YYYY-MM-DD date is a valid NSE trading session.
 */
export function isExchangeTradingDay(
  dateStr: string,
  holidays: string[] = DEFAULT_NSE_HOLIDAYS_2026_2027
): boolean {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) return false;
  const day = d.getUTCDay();
  // Saturday (6) and Sunday (0) are non-trading
  if (day === 0 || day === 6) return false;
  // NSE official holidays
  if (holidays.includes(dateStr)) return false;
  return true;
}

/**
 * Counts actual completed exchange sessions between two dates (inclusive of start, exclusive of end).
 * Prevents calendar-day subtraction distortions (e.g. weekends/holidays).
 */
export function countExchangeSessions(
  startDateStr: string,
  endDateStr: string,
  holidays: string[] = DEFAULT_NSE_HOLIDAYS_2026_2027
): number {
  const start = new Date(startDateStr + 'T00:00:00Z');
  const end = new Date(endDateStr + 'T00:00:00Z');

  if (start >= end) return 0;

  let sessionCount = 0;
  const curr = new Date(start);

  while (curr < end) {
    const yyyyMmDd = curr.toISOString().split('T')[0];
    if (isExchangeTradingDay(yyyyMmDd, holidays)) {
      sessionCount++;
    }
    curr.setUTCDate(curr.getUTCDate() + 1);
  }

  return sessionCount;
}

/**
 * Calculates the next review date by advancing N exchange sessions from a start date.
 */
export function addExchangeSessions(
  startDateStr: string,
  sessionsToAdd: number,
  holidays: string[] = DEFAULT_NSE_HOLIDAYS_2026_2027
): string {
  const curr = new Date(startDateStr + 'T00:00:00Z');
  let added = 0;

  while (added < sessionsToAdd) {
    curr.setUTCDate(curr.getUTCDate() + 1);
    const yyyyMmDd = curr.toISOString().split('T')[0];
    if (isExchangeTradingDay(yyyyMmDd, holidays)) {
      added++;
    }
  }

  return curr.toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// 2. Position Monitoring with Stale Quote Protection (AX-25)
// ---------------------------------------------------------------------------

export type QuoteFreshness = 'fresh' | 'stale' | 'missing';

export interface PositionMonitoringReport {
  orderId: string;
  symbol: string;
  status: 'filled' | 'closed' | 'review_due' | 'invalidation_triggered' | 'target_reached';
  entryPrice: number;
  quantity: number;
  currentPrice: number | null;
  quoteTimestamp: string | null;
  quoteFreshness: QuoteFreshness;
  quoteAgeMinutes: number | null;
  reliabilityWarning?: string;
  originalThesis: {
    signalId: string;
    intendedTrigger: number;
    targetPrice: number;
    invalidationStop: number;
    maxSessions: number;
    entryReason: string;
    submittedAt: string;
  };
  metrics: {
    sessionsElapsed: number;
    sessionsRemaining: number;
    isReviewDeadlineExceeded: boolean;
    nextReviewSessionDate: string;
    distanceToTargetPct: number | null;
    distanceToStopPct: number | null;
    grossPnL: number | null;
    estimatedExitCosts: number | null; // 0.10% broker/STT + ₹15.34 DP fee
    netEstimatedPnL: number | null;
    pnlStatus: 'confirmed' | 'uncertain' | 'unavailable';
  };
}

/**
 * Assesses quote freshness based on current timestamp and market parameters.
 */
export function assessQuoteFreshness(
  quoteTimestampStr: string | null | undefined,
  asOfTimestampStr: string,
  maxFreshnessMinutes: number = 15
): {
  freshness: QuoteFreshness;
  ageMinutes: number | null;
  warning?: string;
} {
  if (!quoteTimestampStr) {
    return {
      freshness: 'missing',
      ageMinutes: null,
      warning: 'Quote timestamp is absent. Real-time metrics cannot be confirmed.',
    };
  }

  const quoteTime = new Date(quoteTimestampStr).getTime();
  const asOfTime = new Date(asOfTimestampStr).getTime();

  if (isNaN(quoteTime) || isNaN(asOfTime)) {
    return {
      freshness: 'missing',
      ageMinutes: null,
      warning: 'Invalid timestamp format provided.',
    };
  }

  const ageMinutes = Math.max(0, Math.round((asOfTime - quoteTime) / (60 * 1000)));

  if (ageMinutes > maxFreshnessMinutes) {
    return {
      freshness: 'stale',
      ageMinutes,
      warning: `Quote is stale (age: ${ageMinutes} min > max allowed: ${maxFreshnessMinutes} min). Position valuation is uncertain.`,
    };
  }

  return {
    freshness: 'fresh',
    ageMinutes,
  };
}

/**
 * Evaluates current paper position status, distance to stop/target, and net P&L with
 * strict handling of session counts and quote freshness.
 */
export function monitorPositionThesis(
  order: PaperOrder,
  currentPrice: number | null,
  quoteTimestamp: string | null,
  asOfTimestamp: string,
  holidays: string[] = DEFAULT_NSE_HOLIDAYS_2026_2027
): PositionMonitoringReport {
  const { freshness, ageMinutes, warning } = assessQuoteFreshness(
    quoteTimestamp,
    asOfTimestamp,
    15
  );

  const entryDate = order.submittedAt.split('T')[0];
  const asOfDate = asOfTimestamp.split('T')[0];
  const maxSessions = 3; // AX-STRAT-01 standard 1-5 session horizon (3 sessions default)
  const sessionsElapsed = countExchangeSessions(entryDate, asOfDate, holidays);
  const sessionsRemaining = Math.max(0, maxSessions - sessionsElapsed);
  const isReviewDeadlineExceeded = sessionsElapsed >= maxSessions;
  const nextReviewSessionDate = addExchangeSessions(entryDate, maxSessions, holidays);

  const fillPrice = order.fillPrice ?? order.intendedTrigger;
  const quantity = order.filledShares ?? order.requestedShares ?? 0;

  let grossPnL: number | null = null;
  let estimatedExitCosts: number | null = null;
  let netEstimatedPnL: number | null = null;
  let distanceToTargetPct: number | null = null;
  let distanceToStopPct: number | null = null;
  let pnlStatus: 'confirmed' | 'uncertain' | 'unavailable' = 'unavailable';

  let status: PositionMonitoringReport['status'] = 'filled';

  if (currentPrice !== null && freshness !== 'missing') {
    grossPnL = Number(((currentPrice - fillPrice) * quantity).toFixed(2));
    // Cost structure: 0.10% broker/STT/GST + ₹15.34 depository participant exit fee
    const exitNotional = currentPrice * quantity;
    const variableCost = exitNotional * 0.001;
    const dpFee = 15.34;
    estimatedExitCosts = Number((variableCost + dpFee).toFixed(2));
    netEstimatedPnL = Number((grossPnL - estimatedExitCosts).toFixed(2));

    distanceToTargetPct = Number(
      (((order.targetPrice - currentPrice) / currentPrice) * 100).toFixed(2)
    );
    distanceToStopPct = Number(
      (((currentPrice - order.invalidationStop) / currentPrice) * 100).toFixed(2)
    );

    pnlStatus = freshness === 'fresh' ? 'confirmed' : 'uncertain';

    // Status transitions
    if (currentPrice <= order.invalidationStop) {
      status = 'invalidation_triggered';
    } else if (currentPrice >= order.targetPrice) {
      status = 'target_reached';
    } else if (isReviewDeadlineExceeded) {
      status = 'review_due';
    } else {
      status = 'filled';
    }
  } else {
    pnlStatus = 'unavailable';
    if (isReviewDeadlineExceeded) {
      status = 'review_due';
    }
  }

  return {
    orderId: order.id,
    symbol: order.symbol,
    status,
    entryPrice: fillPrice,
    quantity,
    currentPrice,
    quoteTimestamp,
    quoteFreshness: freshness,
    quoteAgeMinutes: ageMinutes,
    reliabilityWarning: warning,
    originalThesis: {
      signalId: order.signalId,
      intendedTrigger: order.intendedTrigger,
      targetPrice: order.targetPrice,
      invalidationStop: order.invalidationStop,
      maxSessions,
      entryReason: `Strategy AX-STRAT-01 breakout trigger above ₹${order.intendedTrigger}`,
      submittedAt: order.submittedAt,
    },
    metrics: {
      sessionsElapsed,
      sessionsRemaining,
      isReviewDeadlineExceeded,
      nextReviewSessionDate,
      distanceToTargetPct,
      distanceToStopPct,
      grossPnL,
      estimatedExitCosts,
      netEstimatedPnL,
      pnlStatus,
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Dated Corporate Announcements & Quarterly Results (AX-26)
// ---------------------------------------------------------------------------

export type CorporateEventCategory =
  | 'quarterly_results'
  | 'board_meeting'
  | 'credit_rating'
  | 'regulatory_action'
  | 'auditor_action'
  | 'management_change'
  | 'capital_allocation';

export interface FactualDelta {
  metric: string;
  previousValue?: string | number;
  newValue: string | number;
  unit?: string;
  direction?: 'increase' | 'decrease' | 'neutral' | 'qualified';
}

export interface CorporateAnnouncement {
  id: string;
  symbol: string;
  companyName: string;
  category: CorporateEventCategory;
  sourceUrl: string;
  // Three distinct timestamps as mandated by AX-26:
  eventTime: string;       // Date when the actual meeting or event took place
  publicationTime: string; // Date/time when exchange publicly disseminated the filing
  ingestionTime: string;   // Date/time when Axion ingested and parsed the announcement
  factualDeltas: FactualDelta[];
  factualSummary: string;  // Plain language summary of measured facts without speculative sentiment
  isMaterial: boolean;
}

/**
 * Validates corporate announcement timestamps to enforce zero look-ahead bias.
 * AX-26 Invariant: An announcement cannot be consumed in decision modeling prior to publicationTime.
 */
export function validateEventChronology(
  event: CorporateAnnouncement,
  asOfSimulationTime: string
): { isEligibleForUse: boolean; reason?: string } {
  const pubTime = new Date(event.publicationTime).getTime();
  const simTime = new Date(asOfSimulationTime).getTime();
  const ingTime = new Date(event.ingestionTime).getTime();

  if (isNaN(pubTime) || isNaN(simTime) || isNaN(ingTime)) {
    return { isEligibleForUse: false, reason: 'Invalid ISO timestamp in event chronology' };
  }

  if (simTime < pubTime) {
    return {
      isEligibleForUse: false,
      reason: `Lookahead violation: Event was publicly released at ${event.publicationTime}, which is after decision reference time ${asOfSimulationTime}.`,
    };
  }

  if (simTime < ingTime) {
    return {
      isEligibleForUse: false,
      reason: `Ingestion delay: Event was ingested at ${event.ingestionTime}, after decision reference time ${asOfSimulationTime}.`,
    };
  }

  return { isEligibleForUse: true };
}

// ---------------------------------------------------------------------------
// 4. Thesis Review Journal & Anti-Drift Engine (AX-27)
// ---------------------------------------------------------------------------

export type ThesisReviewDecision =
  | 'continue-review'
  | 'reduce-paper-exposure'
  | 'close-paper-position';

export type ThesisIntegrityStatus =
  | 'intact'
  | 'broken_fundamental'
  | 'broken_time_decay'
  | 'inconclusive_missing_data';

export interface ThesisBreakCondition {
  category: 'FINANCIAL_DETERIORATION' | 'AUDITOR_CONCERN' | 'REGULATORY_RISK' | 'DEADLINE_EXCEEDED';
  metric: string;
  observedEvidence: string;
  thresholdViolation: string;
}

export interface ThesisReviewJournalEntry {
  reviewId: string;
  orderId: string;
  symbol: string;
  reviewedAt: string;
  decision: ThesisReviewDecision;
  thesisIntegrity: ThesisIntegrityStatus;
  humanReviewRequired: boolean;
  incompleteFactsReason?: string;
  detectedBreaks: ThesisBreakCondition[];
  originalThesisSnapshot: {
    signalId: string;
    intendedTrigger: number;
    targetPrice: number;
    invalidationStop: number;
    maxSessions: number;
    entryStrategy: string;
  };
  currentMarketSnapshot: {
    currentPrice: number | null;
    quoteFreshness: QuoteFreshness;
    sessionsElapsed: number;
    netEstimatedPnL: number | null;
  };
  antiDriftVerification: {
    isTacticalMomentumPreserved: boolean;
    convertedToLongTermHold: false; // Invariant: Axion strictly refuses to convert losing tactical trades into long holds
    statement: string;
  };
  actionableDirective: string;
}

/**
 * Conducts a thesis review against incoming corporate events, session expiry, and quote freshness.
 * Implements the core anti-thesis-drift logic of AX-27.
 */
export function conductThesisReview(
  monitoringReport: PositionMonitoringReport,
  relevantAnnouncements: CorporateAnnouncement[],
  reviewTimestamp: string
): ThesisReviewJournalEntry {
  const breaks: ThesisBreakCondition[] = [];
  let humanReviewRequired = false;
  let incompleteFactsReason: string | undefined;

  // 1. Check for fundamental thesis-breaking announcements
  for (const event of relevantAnnouncements) {
    if (event.category === 'auditor_action') {
      breaks.push({
        category: 'AUDITOR_CONCERN',
        metric: 'Auditor qualification or resignation',
        observedEvidence: event.factualSummary,
        thresholdViolation: 'Zero tolerance for audit qualifications under AX-STRAT-01',
      });
    }

    if (event.category === 'regulatory_action') {
      breaks.push({
        category: 'REGULATORY_RISK',
        metric: 'Regulatory show-cause / penalty',
        observedEvidence: event.factualSummary,
        thresholdViolation: 'Material regulatory intervention breaches fundamental integrity',
      });
    }

    if (event.category === 'quarterly_results') {
      for (const delta of event.factualDeltas) {
        if (delta.metric.toLowerCase().includes('profit') || delta.metric.toLowerCase().includes('pat')) {
          if (typeof delta.newValue === 'number' && typeof delta.previousValue === 'number') {
            const growthPct = ((delta.newValue - delta.previousValue) / Math.abs(delta.previousValue)) * 100;
            if (growthPct < -30) {
              breaks.push({
                category: 'FINANCIAL_DETERIORATION',
                metric: delta.metric,
                observedEvidence: `PAT fell ${growthPct.toFixed(1)}% (from ${delta.previousValue} to ${delta.newValue})`,
                thresholdViolation: 'Earnings decline > 30% breaks momentum earnings support',
              });
            }
          }
        }
      }
    }
  }

  // 2. Check time horizon decay
  if (monitoringReport.metrics.isReviewDeadlineExceeded) {
    breaks.push({
      category: 'DEADLINE_EXCEEDED',
      metric: 'Exchange sessions elapsed',
      observedEvidence: `${monitoringReport.metrics.sessionsElapsed} sessions elapsed (limit: ${monitoringReport.originalThesis.maxSessions})`,
      thresholdViolation: 'Exceeded maximum permitted holding window for short-horizon swing',
    });
  }

  // 3. Check data completeness
  if (monitoringReport.quoteFreshness !== 'fresh') {
    humanReviewRequired = true;
    incompleteFactsReason = `Quote data freshness is ${monitoringReport.quoteFreshness}. Real-time verification requires fresh quote.`;
  }

  if (relevantAnnouncements.length === 0) {
    // If no announcements exist, verify if review requires disclosure check
    if (monitoringReport.metrics.isReviewDeadlineExceeded) {
      humanReviewRequired = true;
      incompleteFactsReason = (incompleteFactsReason ? incompleteFactsReason + ' | ' : '') +
        'Review deadline reached with no recent earnings filings. Manual verification recommended.';
    }
  }

  // 4. Determine review decision
  let decision: ThesisReviewDecision = 'continue-review';
  let thesisIntegrity: ThesisIntegrityStatus = 'intact';

  const hasFundamentalBreak = breaks.some(b => b.category !== 'DEADLINE_EXCEEDED');
  const hasDeadlineBreak = breaks.some(b => b.category === 'DEADLINE_EXCEEDED');

  if (hasFundamentalBreak) {
    decision = 'close-paper-position';
    thesisIntegrity = 'broken_fundamental';
  } else if (hasDeadlineBreak) {
    decision = 'close-paper-position';
    thesisIntegrity = 'broken_time_decay';
  } else if (humanReviewRequired) {
    decision = 'reduce-paper-exposure';
    thesisIntegrity = 'inconclusive_missing_data';
  } else {
    decision = 'continue-review';
    thesisIntegrity = 'intact';
  }

  const reviewId = `rev_${monitoringReport.orderId}_${reviewTimestamp.replace(/[:.]/g, '-')}`;

  return {
    reviewId,
    orderId: monitoringReport.orderId,
    symbol: monitoringReport.symbol,
    reviewedAt: reviewTimestamp,
    decision,
    thesisIntegrity,
    humanReviewRequired,
    incompleteFactsReason,
    detectedBreaks: breaks,
    originalThesisSnapshot: {
      signalId: monitoringReport.originalThesis.signalId,
      intendedTrigger: monitoringReport.originalThesis.intendedTrigger,
      targetPrice: monitoringReport.originalThesis.targetPrice,
      invalidationStop: monitoringReport.originalThesis.invalidationStop,
      maxSessions: monitoringReport.originalThesis.maxSessions,
      entryStrategy: 'AX-STRAT-01',
    },
    currentMarketSnapshot: {
      currentPrice: monitoringReport.currentPrice,
      quoteFreshness: monitoringReport.quoteFreshness,
      sessionsElapsed: monitoringReport.metrics.sessionsElapsed,
      netEstimatedPnL: monitoringReport.metrics.netEstimatedPnL,
    },
    antiDriftVerification: {
      isTacticalMomentumPreserved: true,
      convertedToLongTermHold: false,
      statement:
        'Anti-Drift Invariant: Short-horizon tactical positions are closed or reduced upon thesis breach or time decay. A declining price is never recast as a long-term investment.',
    },
    actionableDirective:
      decision === 'close-paper-position'
        ? `Submit paper exit order immediately. Reason: ${breaks.map(b => b.thresholdViolation).join('; ')}`
        : decision === 'reduce-paper-exposure'
        ? 'Flag position for urgent review and reduce exposure pending reliable factual confirmation.'
        : 'Thesis intact. Maintain position and monitor next session trigger levels.',
  };
}
