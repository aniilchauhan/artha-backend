/**
 * Wall Street & Tier-1 Institutional Research Frameworks
 *
 * Implements the Complete Top 10 Institutional Research Frameworks:
 * 1. Goldman Sachs-Level Stock Screener (HNW Equity Screening & Moat Rating)
 * 2. Morgan Stanley-Style DCF Valuation Deep Dive (5-Yr FCF, WACC, Sensitivity Matrix)
 * 3. Bridgewater-Inspired Risk Analysis Framework (Ray Dalio Radical Transparency & Stress Testing)
 * 4. JPMorgan-Level Pre-Earnings Breakdown (Beat/Miss History, Options Implied Move, Scenarios)
 * 5. BlackRock-Style Portfolio Construction Model ($500M+ Multi-Asset Allocation & IPS)
 * 6. Citadel-Grade Technical Analysis System (Statistical Market Timing, Support/Resistance & Confluence)
 * 7. Harvard Endowment-Inspired Dividend Strategy ($50B Fund Dividend & DRIP Compounding Blueprint)
 * 8. Bain-Style Competitive Advantage Analysis (Strategic Moat, Innovation & Landscape Deck)
 * 9. Renaissance Technologies Pattern Finder (Jim Simons Statistical Edges & Anomaly Discovery)
 * 10. McKinsey-Level Macro Impact Assessment (Sovereign Wealth Macro Regime & Sector Rotation)
 */

export interface InstitutionalFramework {
  id:
    | 'goldman-sachs-screener'
    | 'morgan-stanley-dcf'
    | 'bridgewater-risk'
    | 'jpmorgan-earnings'
    | 'blackrock-portfolio'
    | 'citadel-technical'
    | 'harvard-dividend'
    | 'bain-advantage'
    | 'renaissance-patterns'
    | 'mckinsey-macro';
  title: string;
  institution: string;
  icon: string;
  roleDescription: string;
  category:
    | 'Stock Screening'
    | 'Valuation'
    | 'Risk Management'
    | 'Earnings Intelligence'
    | 'Portfolio Construction'
    | 'Technical & Quant'
    | 'Dividend & Income'
    | 'Competitive Strategy'
    | 'Statistical Edge'
    | 'Macro & Sovereign';
  keyDeliverables: string[];
  generatePrompt: (context: FrameworkContext) => string;
}

export interface FrameworkContext {
  ticker?: string;
  companyName?: string;
  currentPrice?: number;
  marketCapCr?: number;
  peRatio?: number;
  sector?: string;
  holdings?: Array<{ ticker: string; allocationPercent: number; value?: number }>;
  portfolioValue?: number;
  riskTolerance?: 'Conservative' | 'Moderate' | 'Aggressive';
  investmentAmount?: number;
  timeHorizon?: string;
  earningsDate?: string;
  currentPosition?: string;
  monthlyIncomeGoal?: number;
  accountType?: string;
  taxBracket?: string;
  economicConcern?: string;
}

export const INSTITUTIONAL_FRAMEWORKS: Record<InstitutionalFramework['id'], InstitutionalFramework> = {
  'goldman-sachs-screener': {
    id: 'goldman-sachs-screener',
    title: 'Goldman Sachs-Level Stock Screener',
    institution: 'Goldman Sachs',
    icon: 'Landmark',
    roleDescription: 'Senior Equity Analyst at Goldman Sachs with 20 years of experience screening stocks for high-net-worth clients.',
    category: 'Stock Screening',
    keyDeliverables: [
      'Top 10 stocks matching criteria with ticker symbols',
      'P/E ratio analysis compared to sector averages',
      'Revenue growth trends over the last 5 years',
      'Debt-to-equity health check for each pick',
      'Dividend yield and payout sustainability score',
      'Competitive moat rating (weak, moderate, strong)',
      'Bull case and bear case price targets for 12 months',
      'Risk rating on a scale of 1–10 with clear reasoning',
      'Entry price zones and stop-loss suggestions',
      'Professional equity research screening report with summary table',
    ],
    generatePrompt: (context: FrameworkContext) => {
      const sector = context.sector || 'Indian Equities (NSE/BSE)';
      const risk = context.riskTolerance || 'Moderate';
      const amount = context.investmentAmount ? `₹${context.investmentAmount.toLocaleString('en-IN')}` : '₹10,00,000';
      const horizon = context.timeHorizon || '12–36 months';
      const focus = context.ticker ? `Focus particularly on ${context.ticker} (${context.companyName || 'Target Asset'}) at current price ₹${context.currentPrice !== undefined ? context.currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'current market levels'}.` : '';

      return `You are a senior equity analyst at Goldman Sachs with 20 years of experience screening stocks for high-net-worth clients.

I need a complete stock screening framework for my investment goals.
${focus}

Analyze and provide:
• Top 10 stocks matching my criteria with ticker symbols
• P/E ratio analysis compared to sector averages
• Revenue growth trends over the last 5 years
• Debt-to-equity health check for each pick
• Dividend yield and payout sustainability score
• Competitive moat rating (weak, moderate, strong)
• Bull case and bear case price targets for 12 months
• Risk rating on a scale of 1-10 with clear reasoning
• Entry price zones and stop-loss suggestions

Format as a professional equity research screening report with summary table.

My investment profile:
- Risk Tolerance: ${risk}
- Investment Capital: ${amount}
- Time Horizon: ${horizon}
- Preferred Sectors / Focus: ${sector}`;
    },
  },

  'morgan-stanley-dcf': {
    id: 'morgan-stanley-dcf',
    title: 'Morgan Stanley-Style DCF Valuation Deep Dive',
    institution: 'Morgan Stanley',
    icon: 'Calculator',
    roleDescription: 'VP-level Investment Banker at Morgan Stanley who builds valuation models for Fortune 500 M&A deals.',
    category: 'Valuation',
    keyDeliverables: [
      '5-year revenue projection with growth assumptions',
      'Operating margin estimates based on historical trends',
      'Free cash flow (FCF) calculations year by year',
      'Weighted Average Cost of Capital (WACC) estimate',
      'Terminal value using both exit multiple and perpetuity growth methods',
      'Sensitivity table showing fair value at different discount rates',
      'Comparison of DCF value vs current market price',
      'Clear verdict: undervalued, fairly valued, or overvalued',
      'Key assumptions that could break the model',
      'Investment banking valuation memo with tables and clear math',
    ],
    generatePrompt: (context: FrameworkContext) => {
      const ticker = context.ticker || 'RELIANCE';
      const name = context.companyName || `${ticker} Ltd`;
      const price = context.currentPrice ? `₹${context.currentPrice.toFixed(2)}` : 'Market Price';
      const marketCap = context.marketCapCr ? `₹${context.marketCapCr.toLocaleString('en-IN')} Cr` : 'Standard Cap';

      return `You are a VP-level investment banker at Morgan Stanley who builds valuation models for Fortune 500 M&A deals. I need a full discounted cash flow analysis for a specific stock.

Build out:
• 5-year revenue projection with growth assumptions
• Operating margin estimates based on historical trends
• Free cash flow calculations year by year
• Weighted average cost of capital (WACC) estimate
• Terminal value using both exit multiple and perpetuity growth methods
• Sensitivity table showing fair value at different discount rates (e.g. 9%, 10%, 11%, 12%) vs terminal growth rates (2.5%, 3.0%, 3.5%)
• Comparison of DCF intrinsic value vs current market price (${price})
• Clear verdict: undervalued, fairly valued, or overvalued with % margin of safety
• Key assumptions that could break the model

Format as an investment banking valuation memo with tables and clear math.

The stock I want valued: ${ticker} (${name})
Current Market Price: ${price}
Market Capitalization: ${marketCap}
Sector: ${context.sector || 'Indian Equities'}`;
    },
  },

  'bridgewater-risk': {
    id: 'bridgewater-risk',
    title: 'Bridgewater-Inspired Risk Analysis Framework',
    institution: 'Bridgewater Associates (Ray Dalio)',
    icon: 'Shield',
    roleDescription: "Senior Risk Analyst at Bridgewater Associates trained by Ray Dalio's principles of radical transparency in investing.",
    category: 'Risk Management',
    keyDeliverables: [
      'Correlation analysis between holdings',
      'Sector concentration risk with percentage breakdown',
      'Geographic exposure and currency risk factors',
      'Interest rate sensitivity for each position',
      'Recession stress test showing estimated drawdown',
      'Liquidity risk rating for each holding',
      'Single stock risk and position sizing recommendations',
      'Tail risk scenarios with probability estimates',
      'Hedging strategies to reduce top 3 risks',
      'Rebalancing suggestions with specific allocation percentages',
      'Professional risk management report with a heatmap',
    ],
    generatePrompt: (context: FrameworkContext) => {
      const holdingsStr = context.holdings && context.holdings.length > 0
        ? context.holdings.map(h => `${h.ticker}: ${h.allocationPercent}%${h.value ? ` (₹${h.value.toLocaleString('en-IN')})` : ''}`).join('\n')
        : (context.ticker ? `${context.ticker}: 100% position` : 'Diversified Top 5 Indian Equities / Nifty 50 Holdings');
      const totalVal = context.portfolioValue ? `₹${context.portfolioValue.toLocaleString('en-IN')}` : '₹25,00,000';

      return `You are a senior risk analyst at Bridgewater Associates trained by Ray Dalio's principles of radical transparency in investing.

I need a complete risk assessment of my current portfolio.

Evaluate:
• Correlation analysis between my holdings
• Sector concentration risk with percentage breakdown
• Geographic exposure and currency risk factors
• Interest rate sensitivity for each position
• Recession stress test showing estimated drawdown
• Liquidity risk rating for each holding
• Single stock risk and position sizing recommendations
• Tail risk scenarios with probability estimates
• Hedging strategies to reduce my top 3 risks
• Rebalancing suggestions with specific allocation percentages

Format as a professional risk management report with a risk heatmap and stress-test matrix.

My current portfolio:
Total Value: ${totalVal}
Holdings Breakdown:
${holdingsStr}`;
    },
  },

  'jpmorgan-earnings': {
    id: 'jpmorgan-earnings',
    title: 'JPMorgan-Level Earnings Breakdown',
    institution: 'JPMorgan Chase',
    icon: 'TrendingUp',
    roleDescription: 'Senior Equity Research Analyst at JPMorgan Chase who writes earnings previews for institutional investors.',
    category: 'Earnings Intelligence',
    keyDeliverables: [
      'Last 4 quarters earnings vs estimates (beat or miss history)',
      'Revenue and EPS consensus estimates for the upcoming quarter',
      'Key metrics Wall Street / Dalal Street is watching for this specific company',
      'Segment-by-segment revenue breakdown and trends',
      'Management guidance from last earnings call summarized',
      'Options market implied move for earnings day',
      'Historical stock price reaction after last 4 earnings reports',
      'Bull case scenario and price impact estimate',
      'Bear case scenario and downside risk estimate',
      'Recommended tactical play: buy before, sell before, or wait',
      'Pre-earnings research brief with a decision summary at the top',
    ],
    generatePrompt: (context: FrameworkContext) => {
      const ticker = context.ticker || 'TCS';
      const name = context.companyName || `${ticker} Ltd`;
      const price = context.currentPrice ? `₹${context.currentPrice.toFixed(2)}` : 'Market Price';
      const date = context.earningsDate || 'Upcoming Q3/Q4 Results';

      return `You are a senior equity research analyst at JPMorgan Chase who writes earnings previews for institutional investors.

I need a complete earnings analysis before a company reports.

Deliver:
• Last 4 quarters earnings vs estimates (beat or miss history)
• Revenue and EPS consensus estimates for the upcoming quarter
• Key metrics Wall Street / Dalal Street is watching for this specific company
• Segment-by-segment revenue breakdown and trends
• Management guidance from last earnings call summarized
• Options market implied move for earnings day
• Historical stock price reaction after last 4 earnings reports
• Bull case scenario and price impact estimate
• Bear case scenario and downside risk estimate
• My recommended play: buy before, sell before, or wait

Format as a pre-earnings research brief with a decision summary at the top.

The company reporting earnings: ${ticker} (${name})
Current Price: ${price}
Scheduled Reporting Date: ${date}
Sector: ${context.sector || 'Indian Equities'}`;
    },
  },

  'blackrock-portfolio': {
    id: 'blackrock-portfolio',
    title: 'BlackRock-Style Portfolio Construction Model',
    institution: 'BlackRock',
    icon: 'Briefcase',
    roleDescription: 'Senior Portfolio Strategist at BlackRock managing multi-asset portfolios worth $500M+ for institutional clients.',
    category: 'Portfolio Construction',
    keyDeliverables: [
      'Exact asset allocation with percentages across stocks, bonds, alternatives',
      'Specific ETF or fund recommendations for each category with ticker symbols',
      'Core holdings vs satellite positions clearly labeled',
      'Expected annual return range based on historical data',
      'Expected maximum drawdown in a bad year',
      'Rebalancing schedule and trigger rules',
      'Tax efficiency strategy for account type',
      'Dollar-cost averaging (DCA) plan if investing monthly',
      'Benchmark to measure performance against',
      'One-page Investment Policy Statement (IPS) with allocation pie chart description',
    ],
    generatePrompt: (context: FrameworkContext) => {
      const amount = context.investmentAmount ? `₹${context.investmentAmount.toLocaleString('en-IN')}` : '₹25,00,000';
      const risk = context.riskTolerance || 'Moderate-Aggressive';
      const horizon = context.timeHorizon || '5–10 years';

      return `You are a senior portfolio strategist at BlackRock managing multi-asset portfolios worth $500M+ for institutional clients. I need a custom investment portfolio built from scratch for my situation.

Create:
• Exact asset allocation with percentages across stocks, bonds, alternatives (Gold/Commodities/Real Estate)
• Specific ETF or fund recommendations for each category with ticker symbols (Nifty 50, Nifty Midcap, Bharat Bond, Sovereign Gold, etc.)
• Core holdings vs satellite positions clearly labeled
• Expected annual return range based on historical data
• Expected maximum drawdown in a bad year
• Rebalancing schedule and trigger rules (e.g. 5% absolute drift)
• Tax efficiency strategy for long-term compounding in India
• Dollar cost averaging plan if I invest monthly
• Benchmark to measure my performance against (e.g. Nifty 500 TRI)
• One-page investment policy statement I can follow

Format as a professional investment policy document with an allocation breakdown.

My details:
- Capital to Deploy: ${amount}
- Risk Tolerance: ${risk}
- Time Horizon: ${horizon}
- Goal: Wealth Compounding & Inflation Outperformance
- Monthly Additions: ₹50,000 / month`;
    },
  },

  'citadel-technical': {
    id: 'citadel-technical',
    title: 'A Citadel-Grade Technical Analysis System',
    institution: 'Citadel',
    icon: 'BarChart2',
    roleDescription: 'Senior Quantitative Trader at Citadel who combines technical analysis with statistical models to time entries and exits.',
    category: 'Technical & Quant',
    keyDeliverables: [
      'Current trend direction on daily, weekly, and monthly timeframes',
      'Key support and resistance levels with exact price points',
      'Moving average analysis (50-day, 100-day, 200-day) and crossover signals',
      'RSI, MACD, and Bollinger Band readings with plain-English interpretation',
      'Volume trend analysis and what it signals about buyer vs seller strength',
      'Chart pattern identification (head and shoulders, cup and handle, flags)',
      'Fibonacci retracement levels for potential bounce zones',
      'Ideal entry price, stop-loss level, and profit target',
      'Risk-to-reward ratio for the current setup',
      'Confidence rating: strong buy, buy, neutral, sell, strong sell',
    ],
    generatePrompt: (context: FrameworkContext) => {
      const ticker = context.ticker || 'TATAMOTORS';
      const name = context.companyName || `${ticker} Ltd`;
      const price = context.currentPrice ? `₹${context.currentPrice.toFixed(2)}` : 'Market Price';
      const pos = context.currentPosition || 'Currently unallocated / Looking for entry zone';

      return `You are a senior quantitative trader at Citadel who combines technical analysis with statistical models to time entries and exits.
I need a full technical analysis breakdown of a stock.

Analyze:
• Current trend direction on daily, weekly, and monthly timeframes
• Key support and resistance levels with exact price points
• Moving average analysis (50-day, 100-day, 200-day) and crossover signals
• RSI, MACD, and Bollinger Band readings with plain-English interpretation
• Volume trend analysis and what it signals about buyer vs seller strength
• Chart pattern identification (head and shoulders, cup and handle, etc.)
• Fibonacci retracement levels for potential bounce zones
• Ideal entry price, stop-loss level, and profit target
• Risk-to-reward ratio for the current setup
• Confidence rating: strong buy, buy, neutral, sell, strong sell

Format as a technical analysis report card with a clear trade plan summary.
The stock to analyze: ${ticker} (${name})
Current Price: ${price}
My Current Position: ${pos}`;
    },
  },

  'harvard-dividend': {
    id: 'harvard-dividend',
    title: 'A Harvard Endowment-Inspired Dividend Strategy',
    institution: "Harvard Endowment ($50B)",
    icon: 'GraduationCap',
    roleDescription: "Chief Investment Strategist for Harvard's $50B endowment fund specializing in income-generating equity strategies.",
    category: 'Dividend & Income',
    keyDeliverables: [
      '15–20 dividend stock picks with ticker symbols and current yield',
      'Dividend safety score for each stock (1–10 scale)',
      'Consecutive years of dividend growth for each pick',
      'Payout ratio analysis to flag any unsustainable dividends',
      'Monthly income projection based on investment amount',
      'Sector diversification breakdown to avoid concentration',
      'Dividend growth rate estimate for the next 5 years',
      'DRIP reinvestment projection showing compounding over 10 years',
      'Tax implications summary for dividends in specified account type',
      'Ranked list from safest to most aggressive picks',
    ],
    generatePrompt: (context: FrameworkContext) => {
      const amount = context.investmentAmount ? `₹${context.investmentAmount.toLocaleString('en-IN')}` : '₹50,00,000';
      const monthlyGoal = context.monthlyIncomeGoal ? `₹${context.monthlyIncomeGoal.toLocaleString('en-IN')}` : '₹35,000 / month';
      const tax = context.taxBracket || '30% Slab (Indian Income Tax)';

      return `You are the chief investment strategist for Harvard's $50B endowment fund specializing in income-generating equity strategies.
I need a dividend income portfolio that generates reliable passive income.

Build:
• 15-20 dividend stock picks with ticker symbols and current yield (Focus: High-quality Indian dividend payers: ITC, Coal India, TCS, Vedanta, Power Grid, etc.)
• Dividend safety score for each stock (1-10 scale)
• Consecutive years of dividend growth for each pick
• Payout ratio analysis to flag any unsustainable dividends
• Monthly income projection based on my investment amount
• Sector diversification breakdown to avoid concentration
• Dividend growth rate estimate for the next 5 years
• DRIP reinvestment projection showing compounding over 10 years
• Tax implications summary for dividends in my account type
• Ranked list from safest to most aggressive picks

Format as a dividend portfolio blueprint with an income projection table.
My situation:
- Total Investment Capital: ${amount}
- Monthly Passive Income Target: ${monthlyGoal}
- Tax Bracket: ${tax}
- Investment Horizon: Long-term compounding (10+ years)`;
    },
  },

  'bain-advantage': {
    id: 'bain-advantage',
    title: 'A Bain-Style Competitive Advantage Analysis',
    institution: 'Bain & Company',
    icon: 'Trophy',
    roleDescription: 'Senior Partner at Bain & Company conducting a competitive strategy analysis for a major investment fund evaluating an industry.',
    category: 'Competitive Strategy',
    keyDeliverables: [
      'Top 5–7 competitors in the sector with market cap comparison',
      'Revenue and profit margin comparison in a table format',
      'Competitive moat analysis for each company (brand, cost, network, switching)',
      'Market share trends over the last 3 years',
      'Management quality rating based on capital allocation track record',
      'Innovation pipeline and R&D spending comparison',
      'Biggest threats to the sector (regulation, disruption, macro)',
      'SWOT analysis for the top 2 companies',
      'My single best stock pick with a clear rationale',
      'Catalysts that could move the winner stock in the next 12 months',
    ],
    generatePrompt: (context: FrameworkContext) => {
      const sector = context.sector || 'Indian Automotive & EV Transition (Tata Motors, M&M, Maruti)';
      const focus = context.ticker ? `Focus particularly on ${context.ticker} (${context.companyName || 'Lead Contender'}).` : '';

      return `You are a senior partner at Bain & Company conducting a competitive strategy analysis for a major investment fund evaluating an industry.
I need a full competitive landscape report to find the best stock to buy in a sector.
${focus}

Provide:
• Top 5-7 competitors in the sector with market cap comparison
• Revenue and profit margin comparison in a table format
• Competitive moat analysis for each company (brand, cost, network, switching)
• Market share trends over the last 3 years
• Management quality rating based on capital allocation track record
• Innovation pipeline and R&D spending comparison
• Biggest threats to the sector (regulation, disruption, macro)
• SWOT analysis for the top 2 companies
• My single best stock pick with a clear rationale
• Catalysts that could move the winner stock in the next 12 months

Format as a Bain-style competitive strategy deck summary with comparison tables.
The sector I want analyzed: ${sector}`;
    },
  },

  'renaissance-patterns': {
    id: 'renaissance-patterns',
    title: 'The Renaissance Technologies Pattern Finder',
    institution: 'Renaissance Technologies (Medallion)',
    icon: 'Binary',
    roleDescription: 'Quantitative Researcher at Renaissance Technologies using data-driven methods to find statistical edges in the stock market.',
    category: 'Statistical Edge',
    keyDeliverables: [
      'Seasonal patterns: best and worst months historically',
      'Day-of-week performance patterns if any exist',
      'Correlation with major market events (RBI/Fed policy, CPI inflation)',
      'Insider buying and selling patterns from recent regulatory filings',
      'Institutional ownership trend: FII / DII net flows',
      'Short interest analysis and short squeeze potential',
      'Unusual options activity signals (Put-Call Ratio, open interest build)',
      'Price behavior around earnings (pre-run, post-gap patterns)',
      'Sector rotation signals that affect this stock',
      'Statistical edge summary: what gives this stock a quantifiable advantage',
    ],
    generatePrompt: (context: FrameworkContext) => {
      const ticker = context.ticker || 'BAJFINANCE';
      const name = context.companyName || `${ticker} Ltd`;
      const price = context.currentPrice ? `₹${context.currentPrice.toFixed(2)}` : 'Market Price';
      const horizon = context.timeHorizon || 'Last 5 years / Daily & Weekly statistical distribution';

      return `You are a quantitative researcher at Renaissance Technologies using data-driven methods to find statistical edges in the stock market.
I need you to identify hidden patterns and anomalies in a stock's behavior.

Research:
• Seasonal patterns: best and worst months historically
• Day-of-week performance patterns if any exist
• Correlation with major market events (RBI / Fed meetings, CPI reports)
• Insider buying and selling patterns from recent filings
• Institutional ownership trend: are big funds (FII/DII) buying or selling
• Short interest analysis and squeeze potential
• Unusual options activity signals worth watching (OI clusters, PCR skew)
• Price behavior around earnings (pre-run, post-gap patterns)
• Sector rotation signals that affect this stock
• Statistical edge summary: what gives this stock a quantifiable advantage

Format as a quantitative research memo with data tables and pattern summaries.
The stock to investigate: ${ticker} (${name})
Current Market Price: ${price}
Time Period to investigate: ${horizon}`;
    },
  },

  'mckinsey-macro': {
    id: 'mckinsey-macro',
    title: 'A McKinsey-Level Macro Impact Assessment',
    institution: 'McKinsey & Company',
    icon: 'Globe',
    roleDescription: 'Senior Partner at McKinsey Global Institute who advises sovereign wealth funds on how macroeconomic trends affect equity markets.',
    category: 'Macro & Sovereign',
    keyDeliverables: [
      'Current interest rate environment and its impact on growth vs value stocks',
      'Inflation trend analysis and which sectors benefit or suffer',
      'GDP growth forecast and what it means for corporate earnings',
      'US dollar vs INR strength impact on export vs domestic holdings',
      'Employment data trends and consumer spending implications',
      'Central Bank (RBI / Fed) policy outlook for the next 6–12 months',
      'Global risk factors (geopolitics, trade wars, supply chains)',
      'Sector rotation recommendation based on current economic cycle',
      'Specific portfolio adjustments I should consider right now',
      'Timeline: when these macro factors will most likely impact markets',
    ],
    generatePrompt: (context: FrameworkContext) => {
      const holdingsStr = context.holdings && context.holdings.length > 0
        ? context.holdings.map(h => `${h.ticker} (${h.allocationPercent}%)`).join(', ')
        : (context.ticker ? `${context.ticker} and Indian Large/Midcap Equities` : 'Nifty 50, Banking, IT & Capital Goods portfolio');
      const concern = context.economicConcern || 'Interest rate trajectory, global supply chain volatility, and crude oil price inflation';

      return `You are a senior partner at McKinsey's Global Institute who advises sovereign wealth funds on how macroeconomic trends affect equity markets.
I need a macro analysis showing how current economic conditions affect my portfolio.

Analyze:
• Current interest rate environment and its impact on growth vs value stocks
• Inflation trend analysis and which sectors benefit or suffer
• GDP growth forecast and what it means for corporate earnings
• US dollar strength (USD/INR) impact on international vs domestic holdings
• Employment data trends and consumer spending implications
• Federal Reserve & RBI policy outlook for the next 6-12 months
• Global risk factors (geopolitics, trade wars, supply chains)
• Sector rotation recommendation based on current economic cycle
• Specific portfolio adjustments I should consider right now
• Timeline: when these macro factors will most likely impact markets

Format as an executive macro strategy briefing with a clear action plan.
My current holdings: ${holdingsStr}
My biggest concern about the economy: ${concern}`;
    },
  },
};
