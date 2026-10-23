import { PortfolioPerformanceResult } from './portfolio-performance';

export interface DisciplineMetric {
  label: string;
  value: string;
  assessment: string;
  status: 'positive' | 'neutral' | 'warning';
}

export interface ActionDirective {
  ruleNumber: number;
  category: string;
  title: string;
  action: string;
  impact: string;
}

export interface PortfolioAiAuditResult {
  generatedAt: string;
  source: 'gemini' | 'ollama' | 'quant_engine';
  overallScore: number; // 0 - 100
  edgeVerdict: 'UNVALIDATED' | 'SUPERIOR_ALPHA' | 'CONSISTENT_EDGE' | 'HIGH_FRICTION_LEAK' | 'NEGATIVE_EXPECTANCY' | 'EARLY_STAGE';
  verdictLabel: string;
  verdictDescription: string;

  // Executive Diagnosis
  executiveSummary: string;

  // Section 1: Trading Discipline & Mathematical Edge
  disciplineAudit: {
    status: 'UNVERIFIED' | 'EXCELLENT' | 'STABLE' | 'NEEDS_WORK';
    headline: string;
    details: string;
    metrics: DisciplineMetric[];
  };

  // Section 2: Friction Drag & Brokerage Analysis
  frictionAudit: {
    dragPercentage: number;
    severity: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
    headline: string;
    details: string;
    turnoverEfficiency: string;
    recommendation: string;
  };

  // Section 3: Tax status (withheld until required evidence is available)
  taxStrategy: {
    stcgLiability: number;
    ltcgLiability: number;
    totalEstimatedTax: number;
    headline: string;
    harvestingOpportunity: string;
    exemptionsUtilized: string;
  };

  // Section 4: Stock Selection & Pareto Distribution
  selectionAudit: {
    winnerConcentration: string;
    drawdownDrain: string;
    sectorOrStockTakeaway: string;
  };

  // Section 5: Ledger review notes
  actionDirectives: ActionDirective[];
}

export function generatePortfolioAiAudit(
  perf: PortfolioPerformanceResult,
  options?: {
    source?: 'gemini' | 'ollama' | 'quant_engine';
    customExecutiveSummary?: string;
  }
): PortfolioAiAuditResult {
  const closedCount = perf.closedTrades.length;
  let score = 0;
  let edgeVerdict: PortfolioAiAuditResult['edgeVerdict'] = 'UNVALIDATED';
  let verdictLabel = 'Unvalidated local ledger';
  let verdictDescription = 'These user-entered or imported records are descriptive only and have not established strategy performance.';

  if (closedCount > 0) {
    const winRateScore = Math.min(30, (perf.winRate / 100) * 30);
    const profitFactorScore = Math.min(30, (perf.profitFactor / 3) * 30);
    const payoffScore = Math.min(25, (perf.payoffRatio / 2) * 25);
    const frictionScore = Math.max(0, 15 - (perf.chargesDragPct / 100) * 15);
    score = Math.round(Math.min(100, Math.max(0, winRateScore + profitFactorScore + payoffScore + frictionScore)));

    if (score >= 80 && perf.profitFactor >= 2.0 && perf.expectancyPerTrade > 0) {
      edgeVerdict = 'SUPERIOR_ALPHA';
      verdictLabel = 'Superior Mathematical Alpha';
      verdictDescription = 'Outstanding risk-adjusted returns with exceptional payoff ratio and profit factor.';
    } else if (score >= 65 && perf.profitFactor >= 1.3) {
      edgeVerdict = 'CONSISTENT_EDGE';
      verdictLabel = 'Consistent Trading Edge';
      verdictDescription = 'Healthy positive expectancy and disciplined risk-to-reward parameters.';
    } else if (perf.chargesDragPct > 35) {
      edgeVerdict = 'HIGH_FRICTION_LEAK';
      verdictLabel = 'Severe Friction & Cost Drag';
      verdictDescription = 'Excessive churn, fees, and taxes are eroding gross profitability.';
    } else if (perf.expectancyPerTrade < 0 || perf.profitFactor < 1.0) {
      edgeVerdict = 'NEGATIVE_EXPECTANCY';
      verdictLabel = 'Negative Expectancy System';
      verdictDescription = 'Underlying system suffers from negative statistical expectancy.';
    } else {
      edgeVerdict = 'EARLY_STAGE';
      verdictLabel = 'Developing Strategy Baseline';
      verdictDescription = 'Sufficient activity to establish an initial performance baseline.';
    }
  }

  // 2. Executive Summary
  const executiveSummary = options?.customExecutiveSummary || (
    `The selected local ledger contains ${closedCount} closed records (${perf.winningTrades} positive and ${perf.losingTrades} negative under the current calculation). ` +
    `Recorded gross P&L is ₹${Number(perf.realized || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}; recorded or estimated charges are ₹${Number(perf.totalCharges || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}. ` +
    `These figures describe this ledger only and do not establish strategy performance or predict future results.`
  );

  // 3. Discipline Audit
  const disciplineAudit = {
    status: 'UNVERIFIED' as const,
    headline: 'Recorded outcomes only',
    details: `The selected local ledger has ${closedCount} closed records with a recorded win rate of ${Number(perf.winRate || 0).toFixed(1)}% and average holding duration of ${perf.avgHoldingDays} days. The sample and data quality have not been independently validated.`,
    metrics: [
      {
        label: 'Win Rate',
        value: `${Number(perf.winRate || 0).toFixed(1)}%`,
        assessment: 'Recorded share of closed rows marked positive',
        status: 'neutral' as const
      },
      {
        label: 'Payoff Ratio',
        value: `${Number(perf.payoffRatio || 0).toFixed(2)}x`,
        assessment: 'Recorded average win divided by average loss',
        status: 'neutral' as const
      },
      {
        label: 'Profit Factor',
        value: `${Number(perf.profitFactor || 0).toFixed(2)}`,
        assessment: 'Recorded gross gains divided by gross losses',
        status: 'neutral' as const
      },
      {
        label: 'Expectancy / Trade',
        value: `${perf.expectancyPerTrade >= 0 ? '+' : ''}₹${Number(perf.expectancyPerTrade || 0).toFixed(1)}`,
        assessment: 'Recorded average gross P&L per closed row',
        status: 'neutral' as const
      }
    ]
  };

  // 4. Friction & Charges Drag Audit
  const frictionSeverity: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' =
    perf.chargesDragPct <= 10 ? 'LOW' :
    perf.chargesDragPct <= 20 ? 'MODERATE' :
    perf.chargesDragPct <= 35 ? 'HIGH' : 'CRITICAL';

  const turnoverEfficiency = Number(perf.totalTurnover || 0) > 0
    ? `${((Number(perf.netRealized || 0) / Number(perf.totalTurnover || 1)) * 100).toFixed(2)}% net margin on turnover`
    : '0.00%';

  const frictionAudit = {
    dragPercentage: Number(perf.chargesDragPct || 0),
    severity: frictionSeverity,
    headline: 'Recorded charges relative to gross P&L',
    details: `The selected ledger includes ₹${Number(perf.totalCharges || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })} in recorded or estimated charges on turnover of ₹${Number(perf.totalTurnover || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}. ` +
      `This is ${Number(perf.chargesDragPct || 0).toFixed(1)}% of gross realized P&L under the current calculation.`,
    turnoverEfficiency,
    recommendation: 'Compare these local cost assumptions with the broker statement. This ratio does not establish an optimal position size.'
  };

  // Tax output is withheld: this tracker lacks verified financial-year aggregates,
  // taxpayer-specific context, and transaction eligibility evidence.
  const taxStrategy = {
    stcgLiability: 0,
    ltcgLiability: 0,
    totalEstimatedTax: 0,
    headline: 'Tax estimate unavailable',
    harvestingOpportunity: 'This local ledger does not verify annual gains, transaction eligibility, or taxpayer-specific inputs. No tax-loss harvesting recommendation is provided.',
    exemptionsUtilized: 'No exemption or tax-liability conclusion is available from this ledger.'
  };

  // 6. Selection & Pareto Distribution
  const topGainerPnl = perf.topGainers.reduce((s, g) => s + g.grossPnl, 0);
  const topLoserPnl = Math.abs(perf.topLosers.reduce((s, l) => s + l.grossPnl, 0));
  const gainerConcentrationPct = perf.totalGains > 0 ? Math.round((topGainerPnl / perf.totalGains) * 100) : 0;
  const loserConcentrationPct = perf.totalLosses > 0 ? Math.round((topLoserPnl / perf.totalLosses) * 100) : 0;

  const selectionAudit = {
    winnerConcentration: `${gainerConcentrationPct}% of total gross gains originated from top ${perf.topGainers.length} tickers (${perf.topGainers.map(g => g.ticker).slice(0, 3).join(', ')}).`,
    drawdownDrain: `${loserConcentrationPct}% of total losses originated from top ${perf.topLosers.length} drawdown tickers (${perf.topLosers.map(l => l.ticker).slice(0, 3).join(', ')}).`,
    sectorOrStockTakeaway: perf.largestWin && perf.largestLoss
      ? `Largest single winner was ${perf.largestWin.ticker} (+₹${Number(perf.largestWin.grossPnl || 0).toFixed(0)}, ${Number(perf.largestWin.returnPercent || 0).toFixed(1)}% in ${perf.largestWin.holdingDays}d), while largest drawdown was ${perf.largestLoss.ticker} (-₹${Math.abs(Number(perf.largestLoss.grossPnl || 0)).toFixed(0)}, ${Number(perf.largestLoss.returnPercent || 0).toFixed(1)}% in ${perf.largestLoss.holdingDays}d).`
      : 'Leaderboard is balanced across multiple stock positions.'
  };

  // 7. Action Directives
  const actionDirectives: ActionDirective[] = [
    {
      ruleNumber: 1,
      category: 'Recorded Loss Review',
      title: 'Review the largest recorded loss',
      action: perf.largestLoss
        ? `The largest recorded closed loss was ${perf.largestLoss.ticker} (-${Number(perf.largestLoss.returnPercent || 0).toFixed(1)}%). This local sample does not predict future loss or establish an appropriate stop level.`
        : 'No closed loss record is available in the selected period.',
      impact: 'Descriptive ledger review only; no risk-control guarantee.'
    },
    {
      ruleNumber: 2,
      category: 'Recorded Cost Review',
      title: 'Verify imported costs and assumptions',
      action: `The local ledger records ₹${Number(perf.totalCharges || 0).toFixed(0)} in charges (${Number(perf.chargesDragPct || 0).toFixed(1)}% of gross realized profit under the current calculation). Verify the inputs against your broker statement; no sizing recommendation is inferred.`,
      impact: 'No future savings estimate is provided.'
    },
    {
      ruleNumber: 3,
      category: 'Tax Data Completeness',
      title: 'Review tax figures against verified statements',
      action: 'This local ledger does not verify financial-year totals, STT eligibility, or taxpayer-specific adjustments. Use your broker statement and current official tax guidance to determine tax treatment.',
      impact: 'No tax liability or savings estimate is provided.'
    }
  ];

  return {
    generatedAt: new Date().toISOString(),
    source: options?.source || 'quant_engine',
    overallScore: score,
    edgeVerdict,
    verdictLabel,
    verdictDescription,
    executiveSummary,
    disciplineAudit,
    frictionAudit,
    taxStrategy,
    selectionAudit,
    actionDirectives
  };
}
