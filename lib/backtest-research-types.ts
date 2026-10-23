export const RESEARCH_RULES = ['momentum5','momentum20','momentum60','trend_pullback','breakout20','breakout10','mean_reversion','low_vol_trend'] as const;
export const RESEARCH_HOLDS = [1,2,3,4,5,10,20];
export const RESEARCH_EXITS = ['time','stop2_target4','stop3_target6'];
export const RULE_LABELS: Record<string,string> = {momentum5:'5-session momentum',momentum20:'20-session momentum',momentum60:'60-session momentum',trend_pullback:'Trend pullback',breakout20:'20-session breakout',breakout10:'10-session breakout',mean_reversion:'Mean reversion',low_vol_trend:'Low-volatility trend'};
export const RULE_REASONS: Record<string,string> = {
  momentum5:'Positive trailing five-session return; ranked by that return.',
  momentum20:'Positive trailing 20-session return; stock and Nifty above their 50-session averages; ranked by 20-session return.',
  momentum60:'Positive trailing 60-session return; stock and Nifty above their 50-session averages; ranked by 60-session return.',
  trend_pullback:'Stock and Nifty above 50-session averages; positive 20-session return with a five-session decline of 0–6%; ranked by 20-session return minus five-session return.',
  breakout20:'Close above the preceding 20-session high; volume above 1.5 times its 20-session average; stock and Nifty above 50-session averages; ranked by 20-session return.',
  breakout10:'Close above the preceding 10-session high; stock and Nifty above 50-session averages; ranked by 20-session return.',
  mean_reversion:'RSI14 below 30 and negative five-session return while Nifty is above its 50-session average; ranked by the size of the decline.',
  low_vol_trend:'Positive 20-session return with stock and Nifty above 50-session averages; ranked by negative trailing daily volatility, favoring lower volatility.',
};
export interface ResearchResult {
  key:string;capital_inr:number;rule:string;hold:number;exit:string;stocks:number;period:string;
  final_inr:number;return_pct:number;cagr_pct:number;drawdown_pct:number;trades:number;win_rate_pct:number;
  profit_factor:number|null;unresolved:number;mean_exposure_pct:number;fees_inr:number;stress_return_pct:number;
  stress_drawdown_pct:number;benchmark_return_pct:number;start:string;end:string;
}
export interface ResearchTrade {ticker:string;signal_date:string;entry_date:string;exit_date:string;shares:number;entry_price:number;exit_price:number;fees:number;pnl:number;exit_reason:string;holding_sessions:number;selection_score:number;signal_close:number}
export interface ResearchEquity {date:string;equity:number;cash:number;positions:number;benchmark:number}
export interface ResearchDetail {summary:ResearchResult;trades:ResearchTrade[];equity:ResearchEquity[]}
export interface ResearchPayload extends ResearchDetail {contract:{costs:string;execution:string;limitations:string[]};completion:{rows:number;simulations:number};comparisons:ResearchResult[]}
