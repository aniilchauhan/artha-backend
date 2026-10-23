export const workspacePages = [
  // ─── Core Workflow ────────────────────────────────────────────────────
  { href: '/', name: 'Today', group: 'Core Workflow', description: "Today's setups, qualifying candidates and review-due positions" },
  { href: '/stock-ai', name: 'Stock Research', group: 'Core Workflow', description: 'Evidence, financial checks and single decision card' },
  { href: '/watchlist', name: 'Watchlist', group: 'Core Workflow', description: 'Saved tickers and dated Radar signal IDs with entry conditions, current trigger distance, and expiry' },
  { href: '/portfolio', name: 'Paper Portfolio', group: 'Core Workflow', description: 'Ledger, cash, whole-share holdings and active orders' },
  { href: '/results', name: 'Results', group: 'Core Workflow', description: 'Historical backtests, forward paper ledger and strategy outcomes with clear evidence limits' },
  { href: '/data-health', name: 'Data Health', group: 'Core Workflow', description: 'Catalog size, quote freshness, provider status and health' },

  // ─── Research Labs (Experimental — Labeled) ──────────────────────────
  { href: '/market-forecast', name: 'Market Forecast (Lab)', group: 'Research Labs', description: 'Nifty, Bank Nifty and Sensex scenarios and crash-risk evidence' },
  { href: '/rapid-moves', name: '10% Move Radar (Lab)', group: 'Research Labs', description: '1–5 session breakout candidates and circuit momentum watch' },
  { href: '/research-backtests', name: 'Portfolio Backtests (Lab)', group: 'Research Labs', description: 'Standalone historical simulations with cost, drawdown and trade-level audits' },
  { href: '/research-paper', name: 'Radar Paper Ledger (Lab)', group: 'Research Labs', description: 'Direct view of signal-linked paper plans, worker sessions and reconciled event history' },
  { href: '/portfolio-tracker', name: 'Manual Holdings Tracker (Local)', group: 'Research Labs', description: 'User-entered holdings and statement imports stored in the personal portfolio; separate from Radar paper records' },
  { href: '/paper-predictions', name: 'Legacy Cohort Archive (Unverified)', group: 'Research Labs', description: 'Read-only historical rows; legacy results are not calibration or strategy-performance evidence' },
  { href: '/swing-opportunities', name: 'Swing Setups (Lab)', group: 'Research Labs', description: 'Multi-session 10% swing research scanner' },
  { href: '/frameworks', name: 'Strategy Lab (Lab)', group: 'Research Labs', description: 'Evaluate institutional quantitative rules and frameworks' },
  { href: '/quant', name: 'Quant Suite (Lab)', group: 'Research Labs', description: 'Quantitative risk modeling and portfolio optimization' },
  { href: '/small-cap-predictions', name: 'Small Cap 2% Picks (Lab)', group: 'Research Labs', description: 'Small-cap momentum research setups' },
  { href: '/futures-options', name: 'Futures & Options (Lab)', group: 'Research Labs', description: 'Derivatives research, options chain and Greeks' },
  { href: '/gap-analysis', name: 'Gap Analysis (Lab)', group: 'Research Labs', description: 'Overnight gap screening and candle payoff backtests' },
  { href: '/predictions', name: 'Prediction Tracker (Lab)', group: 'Research Labs', description: 'Historical prediction logs and calibration reviews' },

  // ─── Market Reference ────────────────────────────────────────────────
  { href: '/database', name: 'All Stocks Catalog', group: 'Market Reference', description: 'Browse and search 2,500 NSE cash equities' },
  { href: '/screener', name: 'Stock Screener', group: 'Market Reference', description: 'Multi-parameter filter for technical and fundamental metrics' },
  { href: '/market-explorer', name: 'Market Categories', group: 'Market Reference', description: 'Browse sectors, industries and stock categories' },
  { href: '/ipo', name: 'IPO Center', group: 'Market Reference', description: 'Upcoming offerings, listings and IPO outlook' },
  { href: '/news', name: 'Market News', group: 'Market Reference', description: 'Verified news feed and company developments' },
  { href: '/dividends', name: 'Dividends Calendar', group: 'Market Reference', description: 'Upcoming corporate distributions and dividend yield' },
  { href: '/about', name: 'Platform Guide', group: 'Market Reference', description: 'Roadmap, strategy contracts, and methodology' },
  { href: '/auth', name: 'Sign In', group: 'Market Reference', description: 'Owner credentials and personal access' },
];

export function filterWorkspacePages(query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return workspacePages.filter(page => words.every(word => `${page.name} ${page.group} ${page.description}`.toLowerCase().includes(word)));
}
