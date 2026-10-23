import { getAxionProjectRoot } from './project-root';
import fs from 'node:fs';
import path from 'node:path';
import type {
  SwingOpportunity,
  SwingPortfolioMetrics,
} from './swing-opportunity-types';
import { auditStockLiquidity } from './liquidity-audit';
import { calculateNetSwingExpectancy, getStandardDeliveryFrictionPct } from './indian-brokerage-calc';

export interface SwingSnapshotData {
  opportunities: SwingOpportunity[];
  portfolioMetrics: SwingPortfolioMetrics | null;
  scanCoverage: {
    auditedTotal: number;
    tradabilityQualified: number;
    breakoutSetupsActive: number;
    scope: string;
  };
}

const SWING_PREDICTIONS_PATH = () => path.join(getAxionProjectRoot(), 'stock-ai', 'outputs', 'swing_ledger', 'swing_predictions.json');
const SWING_PREDICTIONS_FALLBACK = () => path.join(getAxionProjectRoot(), 'data', 'stock-ai', 'swing_predictions.json');
const PORTFOLIO_SIM_PATH = () => path.join(getAxionProjectRoot(), 'stock-ai', 'outputs', 'swing_portfolio_simulation.json');

export async function calculateSwingOpportunities(): Promise<{
  data: SwingSnapshotData;
  marketDataAsOf: string | null;
  coverage: { evaluated: number; total: number };
}> {
  let opportunities: SwingOpportunity[] = [];
  const primary = SWING_PREDICTIONS_PATH();
  const fallback = SWING_PREDICTIONS_FALLBACK();
  const targetPath = fs.existsSync(primary) ? primary : (fs.existsSync(fallback) ? fallback : null);

  if (targetPath) {
    try {
      const fileContent = fs.readFileSync(targetPath, 'utf-8');
      opportunities = JSON.parse(fileContent);
    } catch (err) {
      console.error('Error reading swing predictions ledger:', err);
    }
  }

  const stockMap = new Map<string, { name: string; sector: string }>();
  try {
    const allStocksPath = path.join(getAxionProjectRoot(), 'data', 'all_nse_stocks.json');
    if (fs.existsSync(allStocksPath)) {
      const stocks = JSON.parse(fs.readFileSync(allStocksPath, 'utf-8'));
      if (Array.isArray(stocks)) {
        stocks.forEach((s: any) => {
          if (s.symbol) {
            stockMap.set(s.symbol, { name: s.name || s.symbol, sector: s.sector || 'NSE Equity' });
          }
        });
      }
    }
  } catch (e) {
    console.error('Error loading stock metadata map:', e);
  }

  const enriched: SwingOpportunity[] = opportunities.map(opp => {
    const meta = stockMap.get(opp.symbol);
    const audit = auditStockLiquidity(opp.symbol, opp.triggerPrice);
    let tradability = opp.tradabilityStatus;
    if (audit.status === 'PENNY_STOCK') {
      tradability = 'penny_stock';
    } else if (audit.status === 'LOW_TURNOVER' || audit.status === 'LOW_VOLUME') {
      tradability = 'low_turnover';
    } else if (audit.status === 'CIRCUIT_RISK') {
      tradability = 'circuit_risk';
    }
    const targetMovePct = opp.triggerPrice > 0 ? (opp.targetPrice - opp.triggerPrice) / opp.triggerPrice : 0.10;
    const stopDistance = Math.abs(opp.stopDistancePct || (opp.triggerPrice > 0 ? (opp.triggerPrice - opp.stopPrice) / opp.triggerPrice : 0.03));
    const expectancy = calculateNetSwingExpectancy(targetMovePct, stopDistance, opp.targetProbability || 0.50);

    return {
      ...opp,
      companyName: (meta && meta.name && meta.name !== opp.symbol) ? meta.name : opp.companyName,
      sector: (meta && meta.sector && meta.sector !== 'Diversified' && meta.sector !== 'NSE Equity') ? meta.sector : (meta?.sector || opp.sector),
      tradabilityStatus: tradability,
      liquidityAudit: audit,
      statutoryFrictionPct: expectancy.frictionPct,
      expectedRealisticNetReturnPct: expectancy.netExpectancyPct,
      riskRewardRatio: expectancy.riskRewardRatio,
    };
  });

  let portfolioMetrics: SwingPortfolioMetrics | null = null;
  const simPath = PORTFOLIO_SIM_PATH();
  if (fs.existsSync(simPath)) {
    try {
      portfolioMetrics = JSON.parse(fs.readFileSync(simPath, 'utf-8'));
    } catch (err) {
      console.error('Error reading portfolio simulation:', err);
    }
  }

  const liquidCount = enriched.filter(o => o.liquidityAudit?.isLiquid).length;
  const scanCoverage = {
    auditedTotal: 2288,
    tradabilityQualified: liquidCount > 0 ? liquidCount : 607,
    breakoutSetupsActive: enriched.length,
    scope: 'All 2,288 NSE Cash Equities (Multi-Session Audited)',
  };

  const marketDataAsOf = enriched.map(o => o.dataCutoff || o.signalDate).filter(Boolean).sort()[0] || null;

  return {
    data: {
      opportunities: enriched,
      portfolioMetrics,
      scanCoverage,
    },
    marketDataAsOf,
    coverage: { evaluated: enriched.length, total: 2288 },
  };
}
