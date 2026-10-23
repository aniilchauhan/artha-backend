import type { FinancialEvidence } from './framework-financials';
import type { FrameworkReport, HorizonAssessment, ResearchHorizon } from './framework-types';

const horizonInfo: Record<ResearchHorizon, { label: string; deadline: string; outcome: string }> = {
  week: { label: 'One week', deadline: 'Entry trigger must occur within three completed NSE benchmark sessions; evaluate at the fifth subsequent completed session.', outcome: 'A candidate is right only if the frozen entry trigger is reached before invalidation within its three-session validity. The fifth-session close is then compared with the assumed entry; overlapping trigger/stop daily bars are unscorable. Nifty and relative returns are recorded separately.' },
  month: { label: 'One month', deadline: 'Twenty-one completed NSE trading sessions after the assessment; exchange holidays excluded.', outcome: 'Positive or nonpositive price return after twenty-one subsequent completed NSE benchmark sessions versus the frozen reference price; the Nifty return and relative return are also recorded. Dividends excluded.' },
  year: { label: 'One year', deadline: 'Twelve calendar months after the assessment; evaluate on the first available completed session on or after that date.', outcome: 'Positive or nonpositive price return at the first completed session on or after twelve calendar months versus the frozen reference price; the Nifty return and relative return are also recorded. Dividends excluded.' },
  multibagger: { label: 'Multibagger research · 3 years', deadline: 'Three calendar years after the assessment; a doubling event is tracked separately from end-date return.', outcome: 'Whether adjusted price first reaches 2× the frozen reference within three years; total return and dividends are not included.' },
};

export function assessResearchHorizon(report: FrameworkReport, horizon: ResearchHorizon, now = Date.now()): HorizonAssessment {
  const technical = report.strategies;
  const matched = technical.filter(item => item.status === 'candidate');
  const unavailableTechnical = technical.some(item => item.status === 'unavailable');
  const financial = report.financials?.checks ?? [];
  const requiredFinancialIds = ['cash-conversion', 'revenue-growth', 'leverage', 'free-cash-flow', 'roiic'];
  const requiredFinancial = requiredFinancialIds.map(id => financial.find(check => check.id === id)).filter(Boolean);
  const requiredFailed = requiredFinancial.some(check => check!.status === 'fail');
  const requiredMissing = !report.financials || requiredFinancial.length !== requiredFinancialIds.length ||
    requiredFinancial.some(check => check!.status === 'unavailable');
  const governanceMissing = !report.financials || financial.some(check => ['pledge', 'rpt', 'cwip', 'contingencies', 'auditor'].includes(check.id) && check.status === 'unavailable');
  const latest = report.inputs.stock?.bars.at(-1);
  const referencePrice = latest?.close ?? null;
  const benchmarkReferencePrice = report.inputs.benchmark?.bars.at(-1)?.close ?? null;
  const primaryTechnical = matched[0];
  const entryTriggerPrice = primaryTechnical?.levels?.trigger ?? null;
  const invalidationPrice = primaryTechnical?.levels?.stop ?? null;
  const entryValiditySessions = primaryTechnical?.levels?.expiresAfterSessions ?? null;
  const evidence = [
    ...technical.flatMap(strategy => strategy.checks.filter(check => check.status === 'pass').map(check => `${strategy.name}: ${check.label} passed (${check.observed ?? 'matched'}${check.unit ? ` ${check.unit}` : ''}).`)),
    ...(report.financials?.statements.map(statement => `Provider annual statement period ended ${statement.periodEnd}; filing publication date and accounting basis are unverified.`) ?? []),
  ];
  const missingEvidence = [...report.limitations];
  let status: HorizonAssessment['status'] = 'insufficient_evidence';
  let flag = 'Insufficient evidence';
  let thesis = 'This assessment does not support a directional forecast. Review the listed evidence gaps before treating the stock as a horizon candidate.';
  let bullCase = 'If the observed setup strengthens and relevant business evidence confirms the thesis, price may appreciate; no defensible target or probability is available.';
  let baseCase = 'The stock may move sideways or fail to outperform its benchmark.';
  let bearCase = 'The setup may fail, the sector or market may weaken, or new company information may impair the thesis.';
  let entryCondition = 'No entry condition is issued until current price, liquidity and the horizon-specific evidence are reviewed.';
  let invalidation = 'Reassess if the supporting setup fails or new evidence contradicts the thesis; no trading stop is supplied by this assessment.';
  let reviewPlan = 'Recheck the source data and thesis at the stated evaluation horizon and after material company disclosures.';

  if (horizon === 'week') {
    status = unavailableTechnical || !referencePrice || !benchmarkReferencePrice || !entryTriggerPrice || !invalidationPrice || !entryValiditySessions ? 'insufficient_evidence' : matched.length ? 'candidate' : 'no_match';
    flag = status === 'candidate' ? 'One-week setup' : unavailableTechnical || !referencePrice || !benchmarkReferencePrice || matched.length ? 'Insufficient evidence' : 'No supported one-week setup';
    thesis = status === 'candidate' ? `Completed-session technical checks match ${matched.map(item => item.name).join(' and ')}. This is an untested setup screen, not a forecast.` : matched.length ? 'Technical conditions matched, but usable stock and benchmark reference prices are required; no prediction was issued.' : 'The selected completed-session technical rules do not currently match a one-week setup.';
    entryCondition = primaryTechnical?.levels ? `${primaryTechnical.name}: enter only after a later daily high reaches ₹${primaryTechnical.levels.trigger.toFixed(2)} within ${primaryTechnical.levels.expiresAfterSessions} benchmark sessions. Outcome tracking assumes a trigger-price fill unless the session opens above the trigger.` : entryCondition;
    invalidation = primaryTechnical?.levels ? `The setup expires after ${primaryTechnical.levels.expiresAfterSessions} benchmark sessions or invalidates at/below ₹${primaryTechnical.levels.stop.toFixed(2)}. Daily bars cannot establish intraday trigger/stop sequence; ambiguous overlap is unscorable.` : invalidation;
    if (unavailableTechnical) missingEvidence.push('One or more technical strategies could not be assessed from completed-session data.');
    if (!referencePrice) missingEvidence.push('A usable completed-session reference price is unavailable.');
    if (!benchmarkReferencePrice) missingEvidence.push('A usable completed-session benchmark reference price is unavailable.');
  } else if (horizon === 'month') {
    status = matched.length && !unavailableTechnical ? 'insufficient_evidence' : unavailableTechnical ? 'insufficient_evidence' : 'no_match';
    flag = matched.length ? 'One-month review candidate · catalyst missing' : unavailableTechnical ? 'Insufficient evidence' : 'No supported one-month setup';
    thesis = matched.length ? 'Technical conditions may justify further review, but no dated, source-verified catalyst feed is connected. A one-month directional assessment is withheld.' : 'No selected technical setup currently supports further one-month review.';
    missingEvidence.push('A dated company, sector or macro catalyst feed and verified publication timestamps are not connected to this report.');
    entryCondition = 'Do not treat the technical screen alone as a one-month entry plan; require a dated catalyst thesis and reassess valuation and liquidity.';
    reviewPlan = 'Before issuing a one-month plan, record the catalyst, expected date, success and failure conditions, and the review milestones.';
  } else if (horizon === 'year') {
    const valuationScenarioMissing = true;
    status = requiredFailed ? 'no_match' : requiredMissing || governanceMissing || valuationScenarioMissing ? 'insufficient_evidence' : matched.length ? 'candidate' : 'wait';
    flag = requiredFailed ? 'Long-term checks not met' : status === 'candidate' ? 'One-year fundamental review candidate' : 'Insufficient evidence for one-year flag';
    thesis = requiredFailed ? 'At least one available financial review check failed. This is a screening result, not a conclusion about the company.' : status === 'candidate' ? 'Available provider statement checks pass; original filings, governance evidence, valuation assumptions and forecast estimates still require analyst review.' : 'The available financial evidence is incomplete or unverified, so a one-year candidate flag is withheld.';
    if (valuationScenarioMissing) missingEvidence.push('A sourced bear/base/bull operating forecast, valuation method and assumptions are not generated by this report.');
    if (governanceMissing) missingEvidence.push('Source-verified governance and disclosure checks are unavailable.');
    if (requiredMissing) missingEvidence.push('One or more required financial statement checks are unavailable or incomplete.');
    entryCondition = 'No price target is issued. Build and source a business forecast, valuation range, dilution assumptions and downside case before deciding on an entry.';
    reviewPlan = 'Review at each reported result and material company disclosure; compare actual revenue, cash flow, debt and per-share economics with the frozen thesis.';
  } else {
    status = requiredFailed ? 'no_match' : 'insufficient_evidence';
    flag = requiredFailed ? 'Multibagger checks not met' : 'Insufficient evidence for multibagger flag';
    thesis = 'A doubling pathway is not established. This app does not yet source governance, dilution, competitive advantage, reinvestment returns, dated milestones or scenario valuation well enough to flag a multibagger candidate.';
    missingEvidence.push('A sourced 3-year per-share earnings/cash-flow pathway, valuation range, dilution analysis, governance review and dated confirming milestones are required.');
    entryCondition = 'No multibagger entry or price target is supplied. First establish a defensible three-year doubling pathway and adverse case.';
    invalidation = 'Any future thesis must name business and valuation milestones whose failure cancels the doubling case.';
    reviewPlan = 'Review only against predeclared business milestones and the three-year deadline; a revised thesis must be saved as a new assessment.';
  }

  const info = horizonInfo[horizon];
  return { horizon, label: info.label, flag, status, assessedAt: new Date(now).toISOString(), referencePrice, benchmarkReferencePrice,
    entryTriggerPrice, invalidationPrice, entryValiditySessions,
    deadline: info.deadline, outcomeDefinition: info.outcome, thesis, bullCase, baseCase, bearCase,
    entryCondition, invalidation, reviewPlan, evidence, missingEvidence: [...new Set(missingEvidence)], probability: null };
}
