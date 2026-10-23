import { getAxionProjectRoot } from './project-root';
import fs from 'fs';
import path from 'path';

export interface SHAPDriver {
  feature: string;
  shap_value: number;
  feature_val: number;
  description: string;
}

export interface StockPrediction {
  Date: string;
  Ticker: string;
  'Model Score': number;
  Label: string;
  'Close (Rs.)': string;
  Close_Numeric: number;
  'RSI (14)': number;
  'Vol Ratio (20d)': number;
  '1D Return': string;
  '5D Return': string;
  'ATR %': string;
  'Nifty Trend': string;
  'Key SHAP Driver': string;
  'SHAP Narrative': string;
  positive_drivers: SHAPDriver[];
  negative_drags: SHAPDriver[];
  'Sentiment Score'?: number;
  'Sentiment Label'?: string;
  'Top News Catalyst'?: string;
  'Catalyst Rationale'?: string;
  'Sentiment Engine'?: string;
  Rank: number;
  isUpcomingEarnings?: boolean;
  isEarningsBinaryRisk?: boolean;
  daysToEarnings?: number;
  earningsSurprise?: 'beat' | 'miss' | 'inline';
  earningsCommentary?: string;
  catalystSignals?: string[];
}

export interface SimulationResult {
  simulation: string;
  threshold: number;
  ambiguous_rule?: string;
  profit_target_pct?: number;
  stop_loss_pct?: number;
  transaction_cost_pct?: number;
  slippage_pct?: number;
  total_signals: number;
  total_trades?: number;
  wins: number;
  losses: number;
  ambiguous_trades?: number;
  win_rate: number;
  avg_return_per_trade?: number;
  cumulative_return?: number;
  profit_factor?: number;
  max_drawdown?: number;
  sharpe_ratio?: number;
  expectancy_per_trade?: number;
  portfolio_assumptions?: {
    initial_capital_inr: number;
    max_concurrent_positions: number;
    position_sizing: string;
    selection: string;
    holding_period: string;
  };
  portfolio_final_value_inr?: number;
  portfolio_cagr?: number | null;
  portfolio_trade_count?: number;
  portfolio_win_rate?: number;
  portfolio_max_drawdown?: number;
  portfolio_annualized_sharpe?: number;
  portfolio_sessions?: number;
  portfolio_active_sessions?: number;
  portfolio_average_positions?: number;
  position_target_pct?: number;
  position_target_hits?: number;
  position_target_hit_rate?: number;
  portfolio_equity_curve?: Array<{
    Date: string;
    equity: number;
    peak_equity: number;
    drawdown: number;
    daily_return: number;
    positions: number;
    exposure_fraction: number;
  }>;
}

export interface StrategyComparison {
  'Strategy Name': string;
  Trades: number;
  'Portfolio Positions': number;
  'Win Rate': string;
  'Target Exit Rate': string;
  'Avg Net Return / Candidate': string;
  'Portfolio Return': string;
  'Portfolio CAGR': string | null;
  'Max Drawdown': string;
  'Profit Factor': string;
  evaluation_id: string;
  raw_metrics: Partial<SimulationResult>;
}

export interface PortfolioThresholdResult {
  threshold: number;
  candidate_signals: number;
  active_signal_sessions: number;
  selected_positions: number;
  active_portfolio_sessions: number;
  target_hits: number;
  target_hit_rate: number;
  portfolio_return: number;
  stressed_portfolio_return: number;
  max_drawdown: number;
  stressed_max_drawdown: number;
  evaluation_id: string;
}

export interface BacktestSummaryData {
  simulation_a: SimulationResult;
  simulation_b: SimulationResult;
  strategy_comparison?: StrategyComparison[];
  threshold_sweep?: PortfolioThresholdResult[];
  threshold_sweep_context?: {
    period: string;
    is_blind_holdout: boolean;
    cutoffs_are_recommendations: boolean;
    note: string;
  };
  session_signal_diagnostics?: Array<{
    date: string;
    scored_tickers: number;
    highest_score: number | null;
    signals_by_threshold: Record<string, number>;
  }>;
  stress_simulation?: SimulationResult;
  promotion_gate?: {
    criteria: Record<string, number | boolean>;
    checks: Record<string, boolean>;
    eligible_for_promotion: boolean;
    status: 'ELIGIBLE' | 'OBSERVATION_ONLY';
  };
  prediction_calendar?: {
    first_session: string | null;
    last_session: string | null;
    sessions: number;
    active_signal_sessions: number;
    active_portfolio_sessions: number;
    candidate_signals_at_threshold: number;
  };
  evaluation_id?: string;
  equity_curve?: Array<{
    Date: string;
    equity: number;
    drawdown: number;
    daily_return?: number;
    positions?: number;
    exposure_fraction?: number;
    ticker?: string;
    result?: string;
  }>;
  trades_sample?: Array<{
    Date: string;
    ticker: string;
    prob: number;
    entry_price: number;
    exit_price: number;
    target_price: number;
    stop_price: number;
    result: string;
    is_ambiguous: boolean;
    gross_return: number;
    net_return: number;
    portfolio_selected?: boolean;
    portfolio_shares?: number;
    portfolio_notional_inr?: number;
    evaluation_id?: string;
    equity: number;
    peak_equity: number;
    drawdown: number;
  }>;
}

export interface CalibrationBucket {
  'Mean Predicted Prob': number;
  'Empirical Fraction Pos': number;
}

export interface ThresholdSweepRow {
  Threshold: number;
  Signals: number;
  'Signal Rate (%)': number;
  'True Pos (Wins)': number;
  'False Pos (Losses)': number;
  'Precision / Win Rate': number;
  Recall: number;
  'F1 Score': number;
}

export interface CalibrationReportData {
  test_start: string;
  test_end: string;
  samples: number;
  positive_rate: number;
  roc_auc: number;
  pr_auc: number;
  threshold_sweep: ThresholdSweepRow[];
  calibration: {
    brier_score: number;
    expected_calibration_error: number;
    calibration_table: CalibrationBucket[];
  };
}

export interface FeatureImportanceItem {
  feature: string;
  importance_gain: number;
  importance_split: number;
  category?: 'Volatility' | 'Benchmark/Sector' | 'Momentum' | 'Volume' | 'Trend';
  description?: string;
}

export interface PortfolioOrder {
  ticker: string;
  model_score: number;
  breakout_trigger_inr: number;
  shares_to_buy: number;
  required_capital_inr: number;
  capital_weight_pct: number;
  stop_loss_inr: number;
  profit_target_inr: number;
  max_risk_inr: number;
  potential_reward_inr: number;
  reward_to_risk_ratio: number;
  kelly_fraction?: number | null;
  expected_pnl_inr?: number;
  status?: string;
  top_catalyst?: string;
  sentiment_label?: string;
}

export interface PortfolioAllocationData {
  capital_base_inr: number;
  max_positions: number;
  risk_per_trade_pct: number;
  sizing_mode?: string;
  total_capital_deployed_inr?: number;
  cash_reserve_inr?: number;
  cash_utilization_pct?: number;
  total_max_risk_inr?: number;
  portfolio_risk_pct?: number;
  orders: PortfolioOrder[];
  summary?: {
    total_positions: number;
    avg_score: number;
    avg_rr: number;
    expected_pnl_inr: number;
  };
  equity_curve?: Array<{
    stage: string;
    equity_inr: number;
    deployed_inr: number;
    cash_inr: number;
    pnl_inr: number;
  }>;
}

// Search locations: primary external stock-ai directory, secondary internal axion/data/stock-ai
function resolveFilePath(primaryRelPath: string, fallbackRelPath: string): string | null {
  const primaryPath = path.resolve(getAxionProjectRoot(), 'stock-ai', primaryRelPath);
  if (fs.existsSync(primaryPath)) {
    return primaryPath;
  }
  const fallbackPath = path.resolve(getAxionProjectRoot(), 'data', 'stock-ai', fallbackRelPath);
  if (fs.existsSync(fallbackPath)) {
    return fallbackPath;
  }
  return null;
}

function readJsonFile<T>(primaryRelPath: string, fallbackRelPath: string): T | null {
  const filePath = resolveFilePath(primaryRelPath, fallbackRelPath);
  if (!filePath) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
    return null;
  }
}

export function getLatestPredictions(): StockPrediction[] {
  const data = readJsonFile<StockPrediction[]>('outputs/latest_predictions.json', 'latest_predictions.json');
  return data || [];
}

export interface BreakdownSetup {
  ticker: string;
  direction: 'SHORT';
  close: number;
  support_20d: number;
  entry_price: number;
  target_price: number;
  stop_loss_price: number;
  risk_rupees: number;
  reward_rupees: number;
  reward_risk_ratio: number;
  rsi_14: number;
  cmf_20: number;
  volume_ratio: number;
  conviction: number;
  optionsRecommendation?: any;
}

export function getLatestBreakdowns(): BreakdownSetup[] {
  const data = readJsonFile<BreakdownSetup[]>('outputs/latest_breakdowns.json', 'latest_breakdowns.json');
  return data || [];
}

export function getBacktestSummary(): BacktestSummaryData | null {
  const summary = readJsonFile<any>('outputs/backtest_summary.json', 'backtest_summary.json');
  const strat = readJsonFile<any>('outputs/strategy_comparison.json', 'strategy_comparison.json');
  const tradesSample = readJsonFile<any[]>('outputs/trades_sample.json', 'trades_sample.json') || [];

  if (!summary) return null;
  const portfolioEquityCurve = summary.simulation_b?.portfolio_equity_curve;
  const comparisonMatchesEvaluation = Array.isArray(strat)
    && strat.length > 0
    && !!summary.evaluation_id
    && strat.every((item: any) => item?.evaluation_id === summary.evaluation_id);
  const tradesMatchEvaluation = Array.isArray(tradesSample)
    && tradesSample.length > 0
    && !!summary.evaluation_id
    && tradesSample.every((item: any) => item?.evaluation_id === summary.evaluation_id);

  return {
    ...summary,
    strategy_comparison: comparisonMatchesEvaluation
      ? strat
      : (Array.isArray(summary.strategy_comparison) ? summary.strategy_comparison : []),
    equity_curve: Array.isArray(portfolioEquityCurve) ? portfolioEquityCurve : [],
    trades_sample: tradesMatchEvaluation ? tradesSample : [],
  };
}

export function getCalibrationReport(): CalibrationReportData | null {
  return readJsonFile<CalibrationReportData>('outputs/evaluation_report.json', 'evaluation_report.json');
}

export function getFeatureImportance(): FeatureImportanceItem[] {
  // Check if CSV exists, parse top features
  const csvPath = resolveFilePath('models/feature_importance.csv', 'feature_importance.csv');
  if (csvPath) {
    try {
      const content = fs.readFileSync(csvPath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim().length > 0);
      const items: FeatureImportanceItem[] = [];

      for (let i = 1; i < Math.min(lines.length, 35); i++) {
        const parts = lines[i].split(',');
        if (parts.length >= 3) {
          const feature = parts[0].trim();
          const gain = parseFloat(parts[1]) || 0;
          const split = parseInt(parts[2], 10) || 0;

          let category: FeatureImportanceItem['category'] = 'Trend';
          let desc = feature;

          if (feature.includes('vix') || feature.includes('atr') || feature.includes('hl_pct') || feature.includes('bb_')) {
            category = 'Volatility';
          } else if (feature.includes('nifty') || feature.includes('cnx')) {
            category = 'Benchmark/Sector';
          } else if (feature.includes('vol') || feature.includes('volume')) {
            category = 'Volume';
          } else if (feature.includes('ret') || feature.includes('rsi') || feature.includes('macd') || feature.includes('roc')) {
            category = 'Momentum';
          }

          if (feature === 'atr_pct') desc = 'Average True Range (% of Close) — Intraday expansion volatility';
          else if (feature === 'india_vix_level') desc = 'India VIX benchmark fear / implied volatility regime';
          else if (feature === 'daily_hl_pct') desc = 'Daily High-to-Low candle spread percentage';
          else if (feature === 'nifty_ret_1d') desc = 'NIFTY 50 1-Day Benchmark return correlation';
          else if (feature === 'vol_20d') desc = '20-Day rolling volume momentum';
          else if (feature === 'gap_pct') desc = 'Overnight open-to-previous-close gap percentage';

          items.push({
            feature,
            importance_gain: gain,
            importance_split: split,
            category,
            description: desc,
          });
        }
      }
      return items;
    } catch (e) {
      console.error('Failed to parse feature_importance.csv:', e);
    }
  }

  return [];
}

export function getPortfolioAllocation(): PortfolioAllocationData | null {
  return readJsonFile<PortfolioAllocationData>('outputs/paper_trading/portfolio_allocation.json', 'portfolio_allocation.json');
}

export function getPaperTradingSignals(): any[] {
  const csvPath = resolveFilePath('outputs/paper_trading/all_signals.csv', 'all_signals.csv');
  if (!csvPath) return [];

  try {
    const raw = fs.readFileSync(csvPath, 'utf-8');
    const lines = raw.split('\n').filter(l => l.trim().length > 0);
    if (lines.length <= 1) return [];

    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim());
      const row: Record<string, any> = {};
      headers.forEach((h, idx) => {
        row[h] = vals[idx] || '';
      });
      return row;
    });
  } catch (e) {
    console.error('Failed to read all_signals.csv', e);
    return [];
  }
}

export interface IntradayScanItem {
  ticker: string;
  name: string;
  asOf: string;
  status: string;
  reference: number;
  target: number;
  estimate: number | null;
  evidenceCount: number;
  summary: string;
  positives: string[];
  risks: string[];
  catalyst: string | null;
  metrics: { label: string; value: string }[];
  liquidityAudit?: any;
  quote?: {
    ticker: string;
    name: string;
    price: number;
    timestamp: number;
    previousClose: number;
    open: number;
    high: number;
    low: number;
    vwap: number | null;
    sessionStart: number;
    sessionEnd: number;
  };
  fetchedAt: string;
  changePct: number;
  fromOpenPct: number;
  vwapGapPct: number;
  sessionValueCrore: number;
  sessionVolume: number;
  opening30High?: number;
  lastCompletedBar?: any;
  illustrativeBreakout?: number;
  illustrativeTarget?: number;
  illustrativeStop?: number;
  momentumEligible: boolean;
  sourceUrl?: string;
}

export interface IntradayManifest {
  generatedAt: string;
  requested: number;
  usable: number;
  excluded: number;
  conditionCounts: Record<string, number>;
  shortlistCount: number;
  methodology: string;
  limitations: string[];
  failures: any[];
}

export function getIntradayScanResults(): IntradayScanItem[] {
  const data = readJsonFile<IntradayScanItem[]>('outputs/intraday/all_results.json', 'intraday/all_results.json');
  if (data && data.length > 0) return data;

  // Fallback to scan500 run directory if canonical is not yet populated
  const runPath = path.resolve(getAxionProjectRoot(), 'stock-ai', 'runs', 'scan500-20260923', 'intraday', 'all_results.json');
  if (fs.existsSync(runPath)) {
    try {
      return JSON.parse(fs.readFileSync(runPath, 'utf-8'));
    } catch {
      return [];
    }
  }
  return [];
}

export function getIntradayShortlist(): IntradayScanItem[] {
  const data = readJsonFile<IntradayScanItem[]>('outputs/intraday/shortlist.json', 'intraday/shortlist.json');
  if (data && data.length > 0) return data;

  const runPath = path.resolve(getAxionProjectRoot(), 'stock-ai', 'runs', 'scan500-20260923', 'intraday', 'shortlist.json');
  if (fs.existsSync(runPath)) {
    try {
      return JSON.parse(fs.readFileSync(runPath, 'utf-8'));
    } catch {
      return [];
    }
  }
  return [];
}

export function getIntradayManifest(): IntradayManifest | null {
  const data = readJsonFile<IntradayManifest>('outputs/intraday/manifest.json', 'intraday/manifest.json');
  if (data) return data;

  const runPath = path.resolve(getAxionProjectRoot(), 'stock-ai', 'runs', 'scan500-20260923', 'intraday', 'manifest.json');
  if (fs.existsSync(runPath)) {
    try {
      return JSON.parse(fs.readFileSync(runPath, 'utf-8'));
    } catch {
      return null;
    }
  }
  return null;
}
