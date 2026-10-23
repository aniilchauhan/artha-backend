/**
 * AX-10 & AX-11: Company Hold Assessment Engine
 *
 * Implements explicit rules separating short-term 1-5 session momentum trades
 * from longer fundamental hold reviews.
 *
 * Invariants:
 * 1. Business description alone never produces a hold approval.
 * 2. Banks and financial institutions do NOT use industrial leverage rules (debt/equity < 0.5).
 * 3. Missing valuation, quarterly results, or governance evidence blocks a fully assessed hold status.
 * 4. A falling trade price never justifies converting a short trade into a long-term hold.
 */

import type { FinancialEvidence } from './framework-financials';
import type { FrameworkCheck } from './framework-types';

export interface CompanyHoldAssessmentDetail {
  status: 'supportive' | 'caution' | 'not_established';
  label: string;
  reason: string;
  isFinancialSector: boolean;
  missingDisclosures: string[];
  supportiveEvidence: string[];
  adverseEvidence: string[];
  applicableChecks: FrameworkCheck[];
}

export function assessCompanyHold(
  evidence: FinancialEvidence,
  hasBusinessProfile: boolean
): CompanyHoldAssessmentDetail {
  const isFinancialSector = !!evidence.sector && /financial|bank|insurance/i.test(evidence.sector);
  const checks = evidence.checks.filter((c) =>
    ['cash-conversion', 'revenue-growth', 'leverage', 'free-cash-flow'].includes(c.id)
  );
  const failed = checks.filter((c) => c.status === 'fail');
  const passed = checks.filter((c) => c.status === 'pass');

  const missingDisclosures: string[] = [
    'Quarterly earnings announcement timing (Q1/Q2/Q3/Q4) is unverified.',
    'Promoter share pledging disclosures from BSE/NSE are missing.',
    'Auditor qualification and notes to accounts from annual report are unavailable.',
    'Related-party transaction (RPT) schedules are unverified.',
    'Point-in-time valuation metrics (P/E, EV/EBITDA) are not verified for historical backtests.',
  ];

  if (isFinancialSector) {
    missingDisclosures.unshift(
      'Banking/financial metrics (CRAR capital adequacy, Gross/Net NPA provisioning, Net Interest Margin) are required but unavailable in standard corporate statements.'
    );
  }

  const supportiveEvidence = passed.map(
    (c) =>
      `${c.label}: Observed ${
        typeof c.observed === 'number'
          ? c.observed.toLocaleString('en-IN', { maximumFractionDigits: 3 })
          : c.observed
      } ${c.unit || ''} (Passes rule: ${c.rule})`
  );

  const adverseEvidence = failed.map(
    (c) =>
      `${c.label}: Observed ${
        typeof c.observed === 'number'
          ? c.observed.toLocaleString('en-IN', { maximumFractionDigits: 3 })
          : c.observed
      } ${c.unit || ''} (Failed rule: ${c.rule})`
  );

  if (isFinancialSector) {
    return {
      status: 'not_established',
      label: 'Longer hold not established',
      reason:
        'Financial Services sector: Industrial corporate leverage (Debt/Equity < 0.5) and working capital rules cannot be applied to banks or financial institutions. Bank-specific metrics (CRAR, NPA ratios) are required but unavailable. Keep 1–5 session trade separate.',
      isFinancialSector: true,
      missingDisclosures,
      supportiveEvidence,
      adverseEvidence,
      applicableChecks: checks,
    };
  }

  if (failed.length > 0) {
    return {
      status: 'caution',
      label: 'Longer hold needs caution',
      reason: `Company review thresholds failed: ${failed.map((c) => c.label).join(', ')}. A price breakout does not resolve these business risks.`,
      isFinancialSector: false,
      missingDisclosures,
      supportiveEvidence,
      adverseEvidence,
      applicableChecks: checks,
    };
  }

  if (!hasBusinessProfile || checks.length !== 4 || checks.some((c) => c.status !== 'pass')) {
    return {
      status: 'not_established',
      label: 'Longer hold not established',
      reason:
        'The business profile or applicable growth, cash-flow and debt evidence is incomplete. Keep the 1–5-session trade separate; missing company data does not justify extending a losing trade.',
      isFinancialSector: false,
      missingDisclosures,
      supportiveEvidence,
      adverseEvidence,
      applicableChecks: checks,
    };
  }

  return {
    status: 'supportive',
    label: 'Company supports further hold review',
    reason:
      'Revenue growth, cash conversion, debt and free cash flow meet the stated review thresholds. Consider a longer hold only after checking valuation, latest results and exchange filings; no holding duration or return is established.',
    isFinancialSector: false,
    missingDisclosures,
    supportiveEvidence,
    adverseEvidence,
    applicableChecks: checks,
  };
}
