import { getArtifactProvenance } from './artifact-provenance';
import { getLatestPredictions, getLatestBreakdowns, getIntradayScanResults, getIntradayManifest } from './stock-ai-service';
import { currentOpportunity, indiaDate, nextOpportunity } from './opportunity-analysis';
import type { OpportunitiesResponse, ShareOpportunity } from './opportunity-types';
import { calculateLeverageScenarios, buildOptionsRecommendation } from './leverage-calculator';
import { auditStockLiquidity } from './liquidity-audit';
import { fetchStockQuote } from './stock-fetcher';
import { refreshStockRows } from './live-stock-rows';
import { loadUniverseStockRecords } from './universe-engine';

export interface OpportunitiesSnapshotData {
  next: {
    data: ShareOpportunity[];
    scanCoverage?: OpportunitiesResponse['scanCoverage'];
    quoteAgeSummary?: OpportunitiesResponse['quoteAgeSummary'];
  };
  today: {
    data: ShareOpportunity[];
    scanCoverage?: OpportunitiesResponse['scanCoverage'];
    quoteAgeSummary?: OpportunitiesResponse['quoteAgeSummary'];
  };
  full: {
    data: ShareOpportunity[];
    scanCoverage?: OpportunitiesResponse['scanCoverage'];
    quoteAgeSummary?: OpportunitiesResponse['quoteAgeSummary'];
  };
}

export function computeOpportunityTiers(reference: number, direction: 'LONG' | 'SHORT', atrPct: number = 2.2) {
  const isLong = direction === 'LONG';
  const t1Pct = Number(Math.max(1.5, Math.min(3.5, atrPct * 0.9)).toFixed(1));
  const t2Pct = Number(Math.max(4.5, Math.min(9.0, atrPct * 2.5)).toFixed(1));
  const t3Pct = Number(Math.max(12.0, Math.min(28.0, atrPct * 5.5)).toFixed(1));

  const t1 = Number((isLong ? reference * (1 + t1Pct / 100) : reference * (1 - t1Pct / 100)).toFixed(2));
  const t2 = Number((isLong ? reference * (1 + t2Pct / 100) : reference * (1 - t2Pct / 100)).toFixed(2));
  const t3 = Number((isLong ? reference * (1 + t3Pct / 100) : reference * (1 - t3Pct / 100)).toFixed(2));

  return {
    targetTiers: [
      { tier: 'T1' as const, label: 'Quick Scalp', price: t1, returnPct: t1Pct },
      { tier: 'T2' as const, label: 'Key Swing Target', price: t2, returnPct: t2Pct },
      { tier: 'T3' as const, label: 'Extended Runner', price: t3, returnPct: t3Pct },
    ],
    maxPotentialPct: t3Pct,
    potentialCategory: (t3Pct >= 12 ? 'runner' : t2Pct >= 5 ? 'swing' : 'scalp') as 'scalp' | 'swing' | 'runner',
  };
}

export async function currentShare(ticker: string): Promise<ShareOpportunity | null> {
  if (!/^[A-Z0-9&.-]{1,30}\.(NS|BO)$/.test(ticker)) return null;
  try {
    const quote = await fetchStockQuote(ticker);
    if (!quote) return null;
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=5m&range=1d`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(6000), cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const chart = payload.chart?.result?.[0];
    const meta = chart?.meta;
    const series = chart?.indicators?.quote?.[0];
    if (!meta || !series || meta.symbol !== quote.providerSymbol || meta.currency !== 'INR') return null;
    let weighted = 0, volume = 0;
    (chart.timestamp || []).forEach((timestamp: number, i: number) => {
      const close = series.close?.[i], v = series.volume?.[i];
      if (Number.isFinite(close) && Number.isFinite(v) && v > 0 &&
          timestamp >= meta.currentTradingPeriod?.regular?.start && timestamp <= meta.regularMarketTime &&
          indiaDate(new Date(timestamp * 1000)) === indiaDate(new Date())) {
        weighted += close * v; volume += v;
      }
    });
    const firstOpen = (series.open || []).find((v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0);
    const opp = currentOpportunity({
      ticker, name: meta.longName || meta.shortName || ticker,
      price: quote.currentPrice, timestamp: Date.parse(quote.quoteAsOf!) / 1000,
      previousClose: quote.currentPrice - quote.change,
      open: firstOpen, high: quote.high, low: quote.low,
      vwap: volume > 0 ? weighted / volume : null,
      sessionStart: meta.currentTradingPeriod?.regular?.start,
      sessionEnd: meta.currentTradingPeriod?.regular?.end,
    });
    if (!opp) return null;
    opp.direction = 'LONG';
    opp.optionsRecommendation = buildOptionsRecommendation(opp.ticker, opp.reference, opp.target, 'LONG');
    opp.leverageDetails = calculateLeverageScenarios(opp);
    if (!opp.liquidityAudit) {
      opp.liquidityAudit = auditStockLiquidity(opp.ticker, opp.reference);
    }
    return opp;
  } catch { return null; }
}

export async function calculateFullUniverseOpportunities(limit: number = 40, search: string = ''): Promise<ShareOpportunity[]> {
  const records = loadUniverseStockRecords();
  const searchLower = search.toLowerCase();
  const filtered = records.filter(r => !searchLower || r.symbol.toLowerCase().includes(searchLower) || r.companyName.toLowerCase().includes(searchLower));
  const observed = await refreshStockRows(filtered.slice(0, limit));

  return observed.map(quote => {
    const s = { ...quote, changePct: quote.changePercent, changeInr: quote.change };
    const isBullish = s.changePct >= 0 || s.rsi14 >= 50;
    const dir: 'LONG' | 'SHORT' = isBullish ? 'LONG' : 'SHORT';
    const tiersData = computeOpportunityTiers(s.currentPrice, dir, s.atrPct);
    const movePct = tiersData.targetTiers[0].returnPct;
    const target = tiersData.targetTiers[0].price;
    const stop = Number((dir === 'LONG' ? s.currentPrice * (1 - movePct / 100) : s.currentPrice * (1 + movePct / 100)).toFixed(2));
    const audit = auditStockLiquidity(s.ticker, s.currentPrice);

    const opp: ShareOpportunity = {
      ticker: s.ticker,
      name: s.companyName,
      asOf: s.quoteAsOf!,
      status: `Provider quote · ${s.quoteStatus}`,
      reference: s.currentPrice,
      target,
      stop,
      entryCondition: `Entry Zone: ₹${s.currentPrice} at session open`,
      deadline: 'Next Session Close (15:25 IST)',
      direction: dir,
      estimate: Math.round(50 + (s.rsi14 > 50 ? (s.rsi14 - 50) : (50 - s.rsi14))),
      evidenceCount: 3,
      summary: `Multi-Tier Target Opportunity: T1 (+${tiersData.targetTiers[0].returnPct}%), T2 (+${tiersData.targetTiers[1].returnPct}%), T3 (+${tiersData.targetTiers[2].returnPct}%). Sector: ${s.sector}.`,
      positives: [
        `1D Price Momentum: ${s.changePct > 0 ? '+' : ''}${s.changePct}%`,
        `RSI (14) indicator level: ${s.rsi14}`,
        `Max Potential Upside: +${tiersData.maxPotentialPct}%`,
      ],
      risks: [
        ...audit.warnings,
        `Defensive stop set at ₹${stop} (-${movePct}%). Trail stop to entry at T1.`,
      ],
      metrics: [
        { label: 'T1 Quick Target', value: `₹${tiersData.targetTiers[0].price} (+${tiersData.targetTiers[0].returnPct}%)` },
        { label: 'T2 Swing Target', value: `₹${tiersData.targetTiers[1].price} (+${tiersData.targetTiers[1].returnPct}%)` },
        { label: 'T3 Runner', value: `₹${tiersData.targetTiers[2].price} (+${tiersData.targetTiers[2].returnPct}%)` },
        { label: 'Max Upside', value: `+${tiersData.maxPotentialPct}% 🚀` },
        { label: 'Liquidity Tier', value: s.liquidityTier },
      ],
      liquidityAudit: audit,
      catalyst: null,
      targetTiers: tiersData.targetTiers,
      maxPotentialPct: tiersData.maxPotentialPct,
      potentialCategory: tiersData.potentialCategory,
      optionsRecommendation: buildOptionsRecommendation(s.ticker, s.currentPrice, target, dir),
    };
    opp.leverageDetails = calculateLeverageScenarios(opp);
    return opp;
  });
}

export async function calculateNextOpportunities(): Promise<{
  data: ShareOpportunity[];
  scanCoverage: OpportunitiesResponse['scanCoverage'];
  quoteAgeSummary: OpportunitiesResponse['quoteAgeSummary'];
}> {
  const predictionProvenance = getArtifactProvenance('latest_predictions.json');
  if (predictionProvenance.status !== 'verified') {
    throw new Error('Prediction artifact is not verified for serving');
  }
  const predictions = getLatestPredictions();
  const longs = predictions.map(p => nextOpportunity(p)).filter((p): p is ShareOpportunity => p !== null);
  for (const item of longs) {
    item.direction = 'LONG';
    const tiersData = computeOpportunityTiers(item.reference, 'LONG', 2.2);
    item.targetTiers = tiersData.targetTiers;
    item.maxPotentialPct = tiersData.maxPotentialPct;
    item.potentialCategory = tiersData.potentialCategory;
    item.optionsRecommendation = buildOptionsRecommendation(item.ticker, item.reference, item.target, 'LONG');
    item.leverageDetails = calculateLeverageScenarios(item);
  }

  const breakdowns = getLatestBreakdowns();
  const shorts: ShareOpportunity[] = breakdowns.map(b => {
    const tiersData = computeOpportunityTiers(b.entry_price, 'SHORT', 2.2);
    const optRec = b.optionsRecommendation || buildOptionsRecommendation(b.ticker, b.entry_price, b.target_price, 'SHORT');
    const audit = auditStockLiquidity(b.ticker, b.entry_price, b.volume_ratio);
    const risks = [
      ...audit.warnings,
      `Protective stop at ₹${b.stop_loss_price}`,
      `Option premium stop at ₹${optRec.stopPremium} (-28%)`,
    ];
    const opp: ShareOpportunity = {
      ticker: b.ticker,
      name: `${b.ticker.replace('.NS', '')} (Short / PE)`,
      asOf: new Date().toISOString().split('T')[0],
      status: 'PENDING',
      reference: b.entry_price,
      target: b.target_price,
      stop: b.stop_loss_price,
      entryCondition: `Sell Short / Buy PE if breaks below support ₹${b.support_20d}`,
      deadline: 'Same-day 15:20 IST (MIS) or Monthly Expiry (PE)',
      direction: 'SHORT',
      estimate: b.conviction,
      evidenceCount: 4,
      summary: `Institutional Breakdown: 20d support break with CMF ${b.cmf_20} & volume ratio ${b.volume_ratio}x.`,
      positives: [
        `Strong downside momentum (RSI ${b.rsi_14})`,
        `Institutional distribution (CMF ${b.cmf_20})`,
        `Max Potential Downside: -${tiersData.maxPotentialPct}%`,
        `F&O Put Option ${optRec.symbolFormatted} target +${optRec.expectedRoiPct}%`,
      ],
      risks,
      metrics: [
        { label: 'Direction', value: 'SHORT / PE' },
        { label: 'Conviction', value: `${Math.round(b.conviction * 100)}%` },
        { label: 'T1 Target', value: `₹${tiersData.targetTiers[0].price} (-${tiersData.targetTiers[0].returnPct}%)` },
        { label: 'T2 Target', value: `₹${tiersData.targetTiers[1].price} (-${tiersData.targetTiers[1].returnPct}%)` },
        { label: 'Max Potential', value: `-${tiersData.maxPotentialPct}%` },
        { label: 'ATM Put Option', value: optRec.symbolFormatted },
      ],
      catalyst: `Bearish Breakdown — ATM ${optRec.symbolFormatted} (+${optRec.expectedRoiPct}% Target)`,
      targetTiers: tiersData.targetTiers,
      maxPotentialPct: tiersData.maxPotentialPct,
      potentialCategory: tiersData.potentialCategory,
      optionsRecommendation: optRec,
      liquidityAudit: audit,
    };
    opp.leverageDetails = calculateLeverageScenarios(opp);
    return opp;
  });

  const data = [...longs, ...shorts].sort((a, b) => (b.estimate ?? 0) - (a.estimate ?? 0));
  const scanCoverage: OpportunitiesResponse['scanCoverage'] = {
    requestedUniverse: 500,
    scanned: predictions.length,
    qualifyingSetups: data.length,
    universeName: 'Nifty 500 Universe (EOD Bhavcopy)',
    asOfDate: predictions[0]?.Date || new Date().toISOString().slice(0, 10),
  };
  const quoteAgeSummary: OpportunitiesResponse['quoteAgeSummary'] = {
    latestQuoteTime: predictions[0]?.Date ? `${predictions[0].Date}T15:30:00.000Z` : new Date().toISOString(),
    averageAgeMinutes: 0,
    isMarketOpen: false,
  };

  return { data, scanCoverage, quoteAgeSummary };
}

export async function calculateTodayOpportunities(): Promise<{
  data: ShareOpportunity[];
  scanCoverage: OpportunitiesResponse['scanCoverage'];
  quoteAgeSummary: OpportunitiesResponse['quoteAgeSummary'];
}> {
  const scanResults = getIntradayScanResults();
  let baseOpportunities: ShareOpportunity[] = [];

  if (scanResults.length > 0) {
    baseOpportunities = scanResults.map(item => {
      const tiersData = computeOpportunityTiers(item.reference, 'LONG', 2.2);
      const optRec = buildOptionsRecommendation(item.ticker, item.reference, tiersData.targetTiers[0].price, 'LONG');
      const audit = item.liquidityAudit || auditStockLiquidity(item.ticker, item.reference);

      const opp: ShareOpportunity = {
        ticker: item.ticker,
        name: item.name,
        asOf: item.asOf,
        status: item.status || 'Current-session quote',
        reference: item.reference,
        target: tiersData.targetTiers[0].price,
        stop: Number((item.reference * (1 - tiersData.targetTiers[0].returnPct / 100)).toFixed(2)),
        entryCondition: item.illustrativeBreakout
          ? `Breakout Watch: ₹${item.illustrativeBreakout.toFixed(2)} (High +0.1%)`
          : `Entry Zone: ₹${item.reference.toFixed(2)}`,
        deadline: 'Same-Day 15:20 IST (MIS) or Monthly Expiry',
        direction: 'LONG',
        estimate: null,
        evidenceCount: item.evidenceCount,
        summary: item.summary,
        positives: item.positives || [],
        risks: item.risks || [],
        metrics: item.metrics || [],
        catalyst: item.catalyst || null,
        targetTiers: tiersData.targetTiers,
        maxPotentialPct: tiersData.maxPotentialPct,
        potentialCategory: tiersData.potentialCategory,
        optionsRecommendation: optRec,
        liquidityAudit: audit,
      };
      (opp as any).sessionValueCrore = item.sessionValueCrore || 0;
      if (item.sessionValueCrore) {
        opp.metrics.push({ label: 'Session Traded Value', value: `₹${item.sessionValueCrore.toFixed(1)} Cr` });
      }
      opp.leverageDetails = calculateLeverageScenarios(opp);
      return opp;
    });
  }

  const manifest = getIntradayManifest();
  const c4 = manifest?.conditionCounts?.['4'] ?? baseOpportunities.filter(d => d.evidenceCount === 4).length;
  const c3 = manifest?.conditionCounts?.['3'] ?? baseOpportunities.filter(d => d.evidenceCount === 3).length;
  const c2 = manifest?.conditionCounts?.['2'] ?? baseOpportunities.filter(d => d.evidenceCount === 2).length;
  const c1 = manifest?.conditionCounts?.['1'] ?? baseOpportunities.filter(d => d.evidenceCount === 1).length;
  const totalEvaluated = manifest?.usable ?? baseOpportunities.length;

  const scanCoverage: OpportunitiesResponse['scanCoverage'] = {
    requestedUniverse: manifest?.requested ?? 500,
    scanned: totalEvaluated,
    qualifyingSetups: c4 + c3,
    condition4Count: c4,
    condition3Count: c3,
    condition2Count: c2,
    condition1Count: c1,
    universeName: 'Nifty 500 Constituents',
    asOfDate: manifest?.generatedAt ? manifest.generatedAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
  };

  const latestTime = baseOpportunities[0]?.asOf || new Date().toISOString();
  const quoteTimeMs = new Date(latestTime).getTime();
  const ageMinutes = Math.max(0, Math.round((Date.now() - quoteTimeMs) / 60000));
  const quoteAgeSummary: OpportunitiesResponse['quoteAgeSummary'] = {
    latestQuoteTime: latestTime,
    averageAgeMinutes: ageMinutes,
    isMarketOpen: ageMinutes <= 20,
  };

  return { data: baseOpportunities, scanCoverage, quoteAgeSummary };
}

export async function calculateOpportunitiesSnapshot(): Promise<{
  data: OpportunitiesSnapshotData;
  marketDataAsOf: string | null;
  coverage: { evaluated: number; total: number };
}> {
  const nextRes = await calculateNextOpportunities();
  const todayRes = await calculateTodayOpportunities().catch(() => ({
    data: [],
    scanCoverage: undefined,
    quoteAgeSummary: undefined,
  }));
  const fullData = await calculateFullUniverseOpportunities(100, '').catch(() => []);

  const marketDataAsOf = nextRes.data[0]?.asOf || null;
  const totalEvaluated = nextRes.scanCoverage?.scanned || nextRes.data.length;

  return {
    data: {
      next: nextRes,
      today: todayRes,
      full: {
        data: fullData,
        scanCoverage: {
          requestedUniverse: 2500,
          scanned: fullData.length,
          qualifyingSetups: fullData.length,
          universeName: 'Full NSE Universe',
          asOfDate: new Date().toISOString().slice(0, 10),
        },
        quoteAgeSummary: {
          latestQuoteTime: fullData[0]?.asOf || new Date().toISOString(),
          averageAgeMinutes: 0,
          isMarketOpen: false,
        },
      },
    },
    marketDataAsOf,
    coverage: { evaluated: totalEvaluated, total: 500 },
  };
}
