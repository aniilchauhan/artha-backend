import { getAxionProjectRoot } from './project-root';
import fs from 'fs';
import { refreshStockRows } from './live-stock-rows';
import path from 'path';
import { PostIpoCandidate, PostIpoResponse, PostIpoBreakoutStatus, AnchorLockinStatus } from './post-ipo-types';
import { calculatePostIpoPrediction } from './post-ipo-prediction-model';

const POST_IPO_CACHE_PATH = path.join(getAxionProjectRoot(), 'data', 'stock-ai', 'post_ipo_breakouts.json');

export const CURATED_POST_IPO_CANDIDATES: PostIpoCandidate[] = [
  // ─── 2024 LANDMARK LISTINGS ────────────────────────────────────────────────
  {
    ticker: 'WAAREEENER.NS',
    symbol: 'WAAREEENER',
    companyName: 'Waaree Energies Ltd',
    sector: 'Solar & Renewable Energy',
    listingDate: '2024-10-28',
    ipoYear: 2024,
    daysSinceListing: 60,
    issuePrice: 1503,
    listingPrice: 2550,
    listingDayHigh: 2624,
    currentPrice: 2980,
    breakoutTriggerPrice: 3050,
    target1: 3750,
    targetMultiBagger: 5200,
    stopLoss: 2600,
    expectedUpsidePct: 74.5,
    listingGainsPct: 69.7,
    breakoutStatus: 'NEAR_PIVOT_ACCUMULATION',
    anchorLockinStatus: 'IN_PROGRESS',
    baseDurationWeeks: 7,
    baseDepthPct: 14.2,
    volumeSurgeRatio: 2.7,
    convictionScore: 96,
    institutionalOwnershipPct: 32.4,
    promoterHoldingPct: 64.3,
    fiiHoldingPct: 18.2,
    diiHoldingPct: 14.2,
    retailHoldingPct: 3.3,
    anchorSharesPercent: 12.8,
    anchorLockin30d: { expiryDate: '2024-11-27', status: 'EXPIRED', sharesPct: 6.4 },
    anchorLockin90d: { expiryDate: '2025-01-26', status: 'PENDING', sharesPct: 6.4 },
    anchorLockin180d: { expiryDate: '2025-04-26', status: 'PENDING', sharesPct: 0.0 },
    keyCatalysts: [
      'Largest solar module manufacturer in India (13.3 GW capacity)',
      'Substantial export order book with US tier-1 developers',
      'Strong institutional accumulation post-listing with zero retail float dumps'
    ],
    risks: [
      'US anti-dumping duty rulings on solar cell exports',
      'Solar supply chain raw polysilicon swings'
    ],
    setupSummary: 'Textbook stage-1 IPO flag consolidation around ₹2,900-₹3,000. Reclaim of ₹3,050 initiates multi-bagger expansion.'
  },
  {
    ticker: 'PREMIERENE.NS',
    symbol: 'PREMIERENE',
    companyName: 'Premier Energies Ltd',
    sector: 'Solar & Clean Tech',
    listingDate: '2024-09-03',
    ipoYear: 2024,
    daysSinceListing: 110,
    issuePrice: 450,
    listingPrice: 990,
    listingDayHigh: 1045,
    currentPrice: 1180,
    breakoutTriggerPrice: 1210,
    target1: 1550,
    targetMultiBagger: 2400,
    stopLoss: 980,
    expectedUpsidePct: 103.4,
    listingGainsPct: 120.0,
    breakoutStatus: 'BREAKOUT_TRIGGERED',
    anchorLockinStatus: 'ABSORBED_STRONG',
    baseDurationWeeks: 12,
    baseDepthPct: 18.5,
    volumeSurgeRatio: 3.4,
    convictionScore: 94,
    institutionalOwnershipPct: 24.8,
    promoterHoldingPct: 72.2,
    fiiHoldingPct: 14.1,
    diiHoldingPct: 10.7,
    retailHoldingPct: 3.0,
    anchorSharesPercent: 14.2,
    anchorLockin30d: { expiryDate: '2024-10-03', status: 'EXPIRED', sharesPct: 7.1 },
    anchorLockin90d: { expiryDate: '2024-12-03', status: 'EXPIRED', sharesPct: 7.1 },
    anchorLockin180d: { expiryDate: '2025-03-03', status: 'PENDING', sharesPct: 0.0 },
    keyCatalysts: [
      'Largest integrated solar cell & module capacity expansion (PLI Scheme beneficiary)',
      '30-day & 90-day anchor lock-in expired with institutional net absorption',
      'High order book visibility extending over 24 months with tier-1 developers'
    ],
    risks: [
      'Global raw silicon wafer price volatility',
      'Custom duty policy adjustments on cell imports'
    ],
    setupSummary: 'Classic stage-1 IPO base breakout above listing-day high of ₹1,045 on 3.4x volume surge with 0 anchor supply overhang remaining.'
  },
  {
    ticker: 'BAJAJHFL.NS',
    symbol: 'BAJAJHFL',
    companyName: 'Bajaj Housing Finance Ltd',
    sector: 'Financial Services / NBFC',
    listingDate: '2024-09-16',
    ipoYear: 2024,
    daysSinceListing: 97,
    issuePrice: 70,
    listingPrice: 150,
    listingDayHigh: 181.5,
    currentPrice: 142,
    breakoutTriggerPrice: 158,
    target1: 195,
    targetMultiBagger: 290,
    stopLoss: 126,
    expectedUpsidePct: 104.2,
    listingGainsPct: 114.3,
    breakoutStatus: 'NEAR_PIVOT_ACCUMULATION',
    anchorLockinStatus: 'ABSORBED_STRONG',
    baseDurationWeeks: 10,
    baseDepthPct: 24.2,
    volumeSurgeRatio: 2.1,
    convictionScore: 89,
    institutionalOwnershipPct: 18.2,
    promoterHoldingPct: 88.8,
    fiiHoldingPct: 7.4,
    diiHoldingPct: 10.8,
    retailHoldingPct: 3.0,
    anchorSharesPercent: 10.5,
    anchorLockin30d: { expiryDate: '2024-10-16', status: 'EXPIRED', sharesPct: 5.25 },
    anchorLockin90d: { expiryDate: '2024-12-16', status: 'EXPIRED', sharesPct: 5.25 },
    anchorLockin180d: { expiryDate: '2025-03-16', status: 'PENDING', sharesPct: 0.0 },
    keyCatalysts: [
      'AAA-rated parentage delivering lowest cost of borrowing in the mortgage sector',
      'Anchor unlock absorbed with domestic mutual funds accumulating aggressively',
      'Prime salaried mortgage book growing at 30%+ CAGR with <0.3% GNPA'
    ],
    risks: [
      'Competitive mortgage rate pressure from tier-1 private banks',
      'Secondary market liquidity stabilization'
    ],
    setupSummary: 'Healthy 10-week rectangular base consolidation between ₹130 and ₹148. Breaking out past ₹158 initiates multi-bagger cycle.'
  },
  {
    ticker: 'SWIGGY.NS',
    symbol: 'SWIGGY',
    companyName: 'Swiggy Ltd',
    sector: 'Consumer Internet / Quick Commerce',
    listingDate: '2024-11-13',
    ipoYear: 2024,
    daysSinceListing: 40,
    issuePrice: 390,
    listingPrice: 420,
    listingDayHigh: 462,
    currentPrice: 475,
    breakoutTriggerPrice: 495,
    target1: 620,
    targetMultiBagger: 980,
    stopLoss: 410,
    expectedUpsidePct: 106.3,
    listingGainsPct: 7.7,
    breakoutStatus: 'NEAR_PIVOT_ACCUMULATION',
    anchorLockinStatus: 'IN_PROGRESS',
    baseDurationWeeks: 5,
    baseDepthPct: 15.0,
    volumeSurgeRatio: 2.2,
    convictionScore: 86,
    institutionalOwnershipPct: 28.0,
    promoterHoldingPct: 0.0,
    fiiHoldingPct: 58.2,
    diiHoldingPct: 16.5,
    retailHoldingPct: 25.3,
    anchorSharesPercent: 18.5,
    anchorLockin30d: { expiryDate: '2024-12-13', status: 'EXPIRED', sharesPct: 9.25 },
    anchorLockin90d: { expiryDate: '2025-02-13', status: 'PENDING', sharesPct: 9.25 },
    anchorLockin180d: { expiryDate: '2025-05-13', status: 'PENDING', sharesPct: 0.0 },
    keyCatalysts: [
      'Instamart quick-commerce dark store ramp up driving positive contribution margin turnaround',
      'Food delivery GOV growing at steady 18-20% with advertising take-rate increases',
      'Early stage post-IPO base setting up near listing day high'
    ],
    risks: [
      'Fierce competitive land-grab in quick commerce (Blinkit, Zepto)',
      '30-day/90-day anchor lock-in phased expiry upcoming'
    ],
    setupSummary: 'Testing ₹475-₹495 zone after post-listing shakeout. Volume accumulating as institutional brokers initiate overweight ratings.'
  },
  {
    ticker: 'HYUNDAI.NS',
    symbol: 'HYUNDAI',
    companyName: 'Hyundai Motor India Ltd',
    sector: 'Automobile Manufacturers',
    listingDate: '2024-10-22',
    ipoYear: 2024,
    daysSinceListing: 65,
    issuePrice: 1960,
    listingPrice: 1934,
    listingDayHigh: 1970,
    currentPrice: 1840,
    breakoutTriggerPrice: 1985,
    target1: 2350,
    targetMultiBagger: 3200,
    stopLoss: 1690,
    expectedUpsidePct: 73.9,
    listingGainsPct: -1.3,
    breakoutStatus: 'BASE_CONSOLIDATION',
    anchorLockinStatus: 'IN_PROGRESS',
    baseDurationWeeks: 8,
    baseDepthPct: 12.5,
    volumeSurgeRatio: 1.8,
    convictionScore: 82,
    institutionalOwnershipPct: 26.5,
    promoterHoldingPct: 82.5,
    fiiHoldingPct: 9.8,
    diiHoldingPct: 5.7,
    retailHoldingPct: 2.0,
    anchorSharesPercent: 14.0,
    anchorLockin30d: { expiryDate: '2024-11-22', status: 'EXPIRED', sharesPct: 7.0 },
    anchorLockin90d: { expiryDate: '2025-01-22', status: 'PENDING', sharesPct: 7.0 },
    anchorLockin180d: { expiryDate: '2025-04-22', status: 'PENDING', sharesPct: 0.0 },
    keyCatalysts: [
      'Largest auto IPO in Indian market history (₹27,870 Cr)',
      'Pune Talegaon plant operationalization adding 250,000 units capacity',
      'Strong SUV product portfolio dominance (Creta, Venue)'
    ],
    risks: [
      'Slowdown in domestic passenger vehicle retail demand',
      'Raw material commodity price inflation'
    ],
    setupSummary: 'Consolidating slightly below issue price in a tight accumulation band. Reclaiming ₹1,985 triggers post-IPO rerating.'
  },
  {
    ticker: 'NTPCGREEN.NS',
    symbol: 'NTPCGREEN',
    companyName: 'NTPC Green Energy Ltd',
    sector: 'Renewable Power Generation',
    listingDate: '2024-11-27',
    ipoYear: 2024,
    daysSinceListing: 25,
    issuePrice: 108,
    listingPrice: 111.5,
    listingDayHigh: 124,
    currentPrice: 128,
    breakoutTriggerPrice: 132,
    target1: 165,
    targetMultiBagger: 240,
    stopLoss: 112,
    expectedUpsidePct: 87.5,
    listingGainsPct: 3.2,
    breakoutStatus: 'NEAR_PIVOT_ACCUMULATION',
    anchorLockinStatus: 'PENDING_30D',
    baseDurationWeeks: 3,
    baseDepthPct: 8.5,
    volumeSurgeRatio: 2.5,
    convictionScore: 88,
    institutionalOwnershipPct: 22.0,
    promoterHoldingPct: 89.0,
    fiiHoldingPct: 5.2,
    diiHoldingPct: 4.8,
    retailHoldingPct: 1.0,
    anchorSharesPercent: 12.0,
    anchorLockin30d: { expiryDate: '2024-12-27', status: 'IMMINENT', sharesPct: 6.0 },
    anchorLockin90d: { expiryDate: '2025-02-27', status: 'PENDING', sharesPct: 6.0 },
    anchorLockin180d: { expiryDate: '2025-05-27', status: 'PENDING', sharesPct: 0.0 },
    keyCatalysts: [
      'PSU renewable champion aiming for 60 GW portfolio by 2032',
      'Zero commercial counterparty risk with central sovereign off-take',
      'High institutional appetite for sovereign green power assets'
    ],
    risks: [
      'Grid evacuation connectivity bottlenecks',
      'Solar reverse auction tariff compression'
    ],
    setupSummary: 'Stage-1 high-tight base setting up directly above listing price. A cross of ₹132 triggers the institutional run.'
  },
  {
    ticker: 'KRN.NS',
    symbol: 'KRN',
    companyName: 'KRN Heat Exchanger and Refrigeration Ltd',
    sector: 'HVAC & Industrial Heat Exchangers',
    listingDate: '2024-10-03',
    ipoYear: 2024,
    daysSinceListing: 80,
    issuePrice: 220,
    listingPrice: 480,
    listingDayHigh: 512,
    currentPrice: 710,
    breakoutTriggerPrice: 745,
    target1: 920,
    targetMultiBagger: 1400,
    stopLoss: 620,
    expectedUpsidePct: 97.2,
    listingGainsPct: 118.2,
    breakoutStatus: 'BREAKOUT_TRIGGERED',
    anchorLockinStatus: 'ABSORBED_STRONG',
    baseDurationWeeks: 9,
    baseDepthPct: 16.0,
    volumeSurgeRatio: 3.1,
    convictionScore: 93,
    institutionalOwnershipPct: 25.4,
    promoterHoldingPct: 71.4,
    fiiHoldingPct: 11.2,
    diiHoldingPct: 14.2,
    retailHoldingPct: 3.2,
    anchorSharesPercent: 15.0,
    anchorLockin30d: { expiryDate: '2024-11-03', status: 'EXPIRED', sharesPct: 7.5 },
    anchorLockin90d: { expiryDate: '2025-01-03', status: 'PENDING', sharesPct: 7.5 },
    anchorLockin180d: { expiryDate: '2025-04-03', status: 'PENDING', sharesPct: 0.0 },
    keyCatalysts: [
      'Neemrana new manufacturing facility expanding copper coil capacity by 4x',
      'Supply chain beneficiary of Daikin, Carrier, Voltas localization mandates',
      'Zero debt balance sheet post IPO issue proceeds'
    ],
    risks: [
      'Copper raw material pricing fluctuations',
      'Customer concentration in top-3 HVAC OEMs'
    ],
    setupSummary: 'Explosive stage-1 base breakout over ₹700 on 3.1x volume expansion following successful 30-day anchor absorption.'
  },
  {
    ticker: 'BHARTIHEXA.NS',
    symbol: 'BHARTIHEXA',
    companyName: 'Bharti Hexacom Ltd',
    sector: 'Telecommunications & Broadband',
    listingDate: '2024-04-12',
    ipoYear: 2024,
    daysSinceListing: 250,
    issuePrice: 570,
    listingPrice: 755,
    listingDayHigh: 830,
    currentPrice: 1390,
    breakoutTriggerPrice: 1420,
    target1: 1720,
    targetMultiBagger: 2400,
    stopLoss: 1220,
    expectedUpsidePct: 72.7,
    listingGainsPct: 32.5,
    breakoutStatus: 'BREAKOUT_TRIGGERED',
    anchorLockinStatus: 'ABSORBED_STRONG',
    baseDurationWeeks: 11,
    baseDepthPct: 13.5,
    volumeSurgeRatio: 2.9,
    convictionScore: 95,
    institutionalOwnershipPct: 28.5,
    promoterHoldingPct: 70.0,
    fiiHoldingPct: 16.2,
    diiHoldingPct: 12.3,
    retailHoldingPct: 1.5,
    anchorSharesPercent: 13.5,
    anchorLockin30d: { expiryDate: '2024-05-12', status: 'EXPIRED', sharesPct: 6.75 },
    anchorLockin90d: { expiryDate: '2024-07-12', status: 'EXPIRED', sharesPct: 6.75 },
    anchorLockin180d: { expiryDate: '2024-10-12', status: 'EXPIRED', sharesPct: 0.0 },
    keyCatalysts: [
      'Industry-leading ARPU expansion in Rajasthan and North East telecom circles',
      'Bharti Airtel subsidiary synergy with 0 capex redundancy',
      'Free cash flow conversion surpassing 40% with tariff hike tailwinds'
    ],
    risks: [
      'Spectrum renewal pricing regulatory updates',
      'Competitive 5G pricing dynamics'
    ],
    setupSummary: 'Textbook 2.4x compounder post-IPO. Stage-2 ascending base breakout continuation underway.'
  },
  {
    ticker: 'JYOTICNC.NS',
    symbol: 'JYOTICNC',
    companyName: 'Jyoti CNC Automation Ltd',
    sector: 'Aerospace & Industrial Robotics',
    listingDate: '2024-01-16',
    ipoYear: 2024,
    daysSinceListing: 340,
    issuePrice: 331,
    listingPrice: 370,
    listingDayHigh: 425,
    currentPrice: 1145,
    breakoutTriggerPrice: 1190,
    target1: 1450,
    targetMultiBagger: 2200,
    stopLoss: 990,
    expectedUpsidePct: 92.1,
    listingGainsPct: 11.8,
    breakoutStatus: 'BREAKOUT_TRIGGERED',
    anchorLockinStatus: 'ABSORBED_STRONG',
    baseDurationWeeks: 8,
    baseDepthPct: 14.8,
    volumeSurgeRatio: 2.9,
    convictionScore: 92,
    institutionalOwnershipPct: 22.4,
    promoterHoldingPct: 62.6,
    fiiHoldingPct: 11.8,
    diiHoldingPct: 10.6,
    retailHoldingPct: 15.0,
    anchorSharesPercent: 12.0,
    anchorLockin30d: { expiryDate: '2024-02-16', status: 'EXPIRED', sharesPct: 6.0 },
    anchorLockin90d: { expiryDate: '2024-04-16', status: 'EXPIRED', sharesPct: 6.0 },
    anchorLockin180d: { expiryDate: '2024-07-16', status: 'EXPIRED', sharesPct: 0.0 },
    keyCatalysts: [
      'Mission-critical multi-axis CNC machines for global aerospace OEMs & Indian Defense',
      'Record multi-year order backlog with margin expansion towards 25% EBITDA',
      'Strong post-listing multi-stage base breakout continuation pattern'
    ],
    risks: [
      'Long production lead cycles and supply chain delay risks',
      'Capex cycle slowdown across automotive clients'
    ],
    setupSummary: 'High-tight base breakout following massive post-listing run. Institutional accumulation continuing into fresh all-time highs.'
  },
  {
    ticker: 'EMCURE.NS',
    symbol: 'EMCURE',
    companyName: 'Emcure Pharmaceuticals Ltd',
    sector: 'Healthcare & Pharma Formulations',
    listingDate: '2024-07-10',
    ipoYear: 2024,
    daysSinceListing: 165,
    issuePrice: 1008,
    listingPrice: 1325,
    listingDayHigh: 1395,
    currentPrice: 1410,
    breakoutTriggerPrice: 1455,
    target1: 1780,
    targetMultiBagger: 2600,
    stopLoss: 1250,
    expectedUpsidePct: 84.4,
    listingGainsPct: 31.5,
    breakoutStatus: 'BREAKOUT_TRIGGERED',
    anchorLockinStatus: 'ABSORBED_STRONG',
    baseDurationWeeks: 14,
    baseDepthPct: 16.2,
    volumeSurgeRatio: 2.8,
    convictionScore: 88,
    institutionalOwnershipPct: 29.5,
    promoterHoldingPct: 78.1,
    fiiHoldingPct: 16.4,
    diiHoldingPct: 13.1,
    retailHoldingPct: 2.4,
    anchorSharesPercent: 13.2,
    anchorLockin30d: { expiryDate: '2024-08-10', status: 'EXPIRED', sharesPct: 6.6 },
    anchorLockin90d: { expiryDate: '2024-10-10', status: 'EXPIRED', sharesPct: 6.6 },
    anchorLockin180d: { expiryDate: '2025-01-10', status: 'PENDING', sharesPct: 0.0 },
    keyCatalysts: [
      'Strong domestic leadership in gynecology and cardiology therapeutics',
      'Debt reduction post-IPO proceeds unlocking ₹120 Cr+ annual interest savings',
      'Anchor 90-day lock-in fully cleared with domestic mutual fund net buying'
    ],
    risks: [
      'Price controls (NLEM) on certain key domestic molecules',
      'Currency volatility across emerging market export subsidiaries'
    ],
    setupSummary: '14-week cup-with-handle formation breaking out past ₹1,455. Volume up 2.8x as anchor sellers completely exited.'
  },

  // ─── 2023 COMPOUNDING CLASSICS (12-24 Months Post-Listing) ─────────────────
  {
    ticker: 'TATATECH.NS',
    symbol: 'TATATECH',
    companyName: 'Tata Technologies Ltd',
    sector: 'Engineering ER&D & Automotive Software',
    listingDate: '2023-11-30',
    ipoYear: 2023,
    daysSinceListing: 380,
    issuePrice: 500,
    listingPrice: 1200,
    listingDayHigh: 1400,
    currentPrice: 910,
    breakoutTriggerPrice: 1040,
    target1: 1280,
    targetMultiBagger: 1850,
    stopLoss: 820,
    expectedUpsidePct: 103.3,
    listingGainsPct: 140.0,
    breakoutStatus: 'BASE_CONSOLIDATION',
    anchorLockinStatus: 'ABSORBED_STRONG',
    baseDurationWeeks: 22,
    baseDepthPct: 35.0,
    volumeSurgeRatio: 2.1,
    convictionScore: 89,
    institutionalOwnershipPct: 24.5,
    promoterHoldingPct: 55.4,
    fiiHoldingPct: 14.8,
    diiHoldingPct: 9.7,
    retailHoldingPct: 20.1,
    anchorSharesPercent: 12.0,
    anchorLockin30d: { expiryDate: '2023-12-30', status: 'EXPIRED', sharesPct: 6.0 },
    anchorLockin90d: { expiryDate: '2024-02-28', status: 'EXPIRED', sharesPct: 6.0 },
    anchorLockin180d: { expiryDate: '2024-05-30', status: 'EXPIRED', sharesPct: 0.0 },
    keyCatalysts: [
      'First Tata Group IPO in nearly 2 decades with pristine balance sheet',
      'Global EV, SDV (software-defined vehicle), and aerospace ER&D contracts',
      'Completed full 1-year flipper cycle washout; forming deep institutional base'
    ],
    risks: [
      'Client concentration in VinFast and European automotive OEM capex cuts',
      'Attrition pressures in premium systems engineering talent'
    ],
    setupSummary: 'Year-long flipper reset complete. Deep cup base building around ₹880-₹920 with breakout trigger at ₹1,040.'
  },
  {
    ticker: 'IREDA.NS',
    symbol: 'IREDA',
    companyName: 'Indian Renewable Energy Dev Agency',
    sector: 'Green Energy Financing & NBFC',
    listingDate: '2023-11-29',
    ipoYear: 2023,
    daysSinceListing: 382,
    issuePrice: 32,
    listingPrice: 50,
    listingDayHigh: 60,
    currentPrice: 205,
    breakoutTriggerPrice: 245,
    target1: 310,
    targetMultiBagger: 480,
    stopLoss: 175,
    expectedUpsidePct: 134.1,
    listingGainsPct: 56.3,
    breakoutStatus: 'BASE_CONSOLIDATION',
    anchorLockinStatus: 'ABSORBED_STRONG',
    baseDurationWeeks: 16,
    baseDepthPct: 28.0,
    volumeSurgeRatio: 3.2,
    convictionScore: 94,
    institutionalOwnershipPct: 19.8,
    promoterHoldingPct: 75.0,
    fiiHoldingPct: 8.5,
    diiHoldingPct: 11.3,
    retailHoldingPct: 5.2,
    anchorSharesPercent: 15.0,
    anchorLockin30d: { expiryDate: '2023-12-29', status: 'EXPIRED', sharesPct: 7.5 },
    anchorLockin90d: { expiryDate: '2024-02-29', status: 'EXPIRED', sharesPct: 7.5 },
    anchorLockin180d: { expiryDate: '2024-05-29', status: 'EXPIRED', sharesPct: 0.0 },
    keyCatalysts: [
      'Navratna PSU status granted; cost of borrowing dropped by 35-50 bps',
      'Loan book scaling past ₹60,000 Cr with record low Net NPA of <0.9%',
      'Sovereign green financing mandate ensuring uninterrupted credit growth'
    ],
    risks: [
      'Discom payment cycle delinquency spillover risks',
      'Equity dilution from prospective QIP'
    ],
    setupSummary: 'Legendary 6.4x runner post-IPO. Consolidating in a high base around ₹200-₹220 before the next leg.'
  },
  {
    ticker: 'MANKIND.NS',
    symbol: 'MANKIND',
    companyName: 'Mankind Pharma Ltd',
    sector: 'Pharma & Consumer Healthcare',
    listingDate: '2023-05-09',
    ipoYear: 2023,
    daysSinceListing: 580,
    issuePrice: 1080,
    listingPrice: 1300,
    listingDayHigh: 1430,
    currentPrice: 2580,
    breakoutTriggerPrice: 2650,
    target1: 3100,
    targetMultiBagger: 4500,
    stopLoss: 2320,
    expectedUpsidePct: 74.4,
    listingGainsPct: 20.4,
    breakoutStatus: 'BASE_CONSOLIDATION',
    anchorLockinStatus: 'ABSORBED_STRONG',
    baseDurationWeeks: 9,
    baseDepthPct: 11.5,
    volumeSurgeRatio: 1.9,
    convictionScore: 91,
    institutionalOwnershipPct: 31.8,
    promoterHoldingPct: 74.9,
    fiiHoldingPct: 15.8,
    diiHoldingPct: 16.0,
    retailHoldingPct: 3.3,
    anchorSharesPercent: 14.5,
    anchorLockin30d: { expiryDate: '2023-06-09', status: 'EXPIRED', sharesPct: 7.25 },
    anchorLockin90d: { expiryDate: '2023-08-09', status: 'EXPIRED', sharesPct: 7.25 },
    anchorLockin180d: { expiryDate: '2023-11-09', status: 'EXPIRED', sharesPct: 0.0 },
    keyCatalysts: [
      'Integration of Bharat Serums acquisition providing high-entry-barrier biologics',
      'Top tier domestic brand recall (Manforce, PregaNews, Gas-O-Fast)',
      'Sustained 18%+ operating margin with industry-leading cash flow conversion'
    ],
    risks: [
      'Integration friction on large M&A buyout debt servicing',
      'Regulatory compliance across domestic API plants'
    ],
    setupSummary: 'Consolidating tightly around ₹2,550 after absorbing secondary block sales. Pivot trigger ₹2,650 unlocks path to ₹4,500+.'
  },
  {
    ticker: 'KAYNES.NS',
    symbol: 'KAYNES',
    companyName: 'Kaynes Technology India Ltd',
    sector: 'EMS & Semiconductor OSAT',
    listingDate: '2022-11-22',
    ipoYear: 2023,
    daysSinceListing: 750,
    issuePrice: 587,
    listingPrice: 775,
    listingDayHigh: 785,
    currentPrice: 5120,
    breakoutTriggerPrice: 5250,
    target1: 6400,
    targetMultiBagger: 9500,
    stopLoss: 4600,
    expectedUpsidePct: 85.5,
    listingGainsPct: 32.0,
    breakoutStatus: 'NEAR_PIVOT_ACCUMULATION',
    anchorLockinStatus: 'ABSORBED_STRONG',
    baseDurationWeeks: 7,
    baseDepthPct: 12.4,
    volumeSurgeRatio: 2.6,
    convictionScore: 95,
    institutionalOwnershipPct: 35.1,
    promoterHoldingPct: 57.8,
    fiiHoldingPct: 18.2,
    diiHoldingPct: 16.9,
    retailHoldingPct: 7.1,
    anchorSharesPercent: 12.0,
    anchorLockin30d: { expiryDate: '2022-12-22', status: 'EXPIRED', sharesPct: 6.0 },
    anchorLockin90d: { expiryDate: '2023-02-22', status: 'EXPIRED', sharesPct: 6.0 },
    anchorLockin180d: { expiryDate: '2023-05-22', status: 'EXPIRED', sharesPct: 0.0 },
    keyCatalysts: [
      'Sanand semiconductor OSAT facility construction underway with central subsidy approval',
      'High-margin aerospace, railway signaling, and industrial IoT product mix expansion',
      'Post-IPO textbook case of 8x compounding with ongoing consolidation breakouts'
    ],
    risks: [
      'High trailing valuation requiring flawless quarterly execution',
      'Semiconductor equipment commissioning timelines'
    ],
    setupSummary: 'Consolidating in a tight 7-week handle pattern after 8x post-IPO rally. A cross of ₹5,250 signals the next compounding leg.'
  },
  {
    ticker: 'NETWEB.NS',
    symbol: 'NETWEB',
    companyName: 'Netweb Technologies India Ltd',
    sector: 'High Performance Computing & AI Servers',
    listingDate: '2023-07-27',
    ipoYear: 2023,
    daysSinceListing: 510,
    issuePrice: 500,
    listingPrice: 947,
    listingDayHigh: 953,
    currentPrice: 2840,
    breakoutTriggerPrice: 2980,
    target1: 3600,
    targetMultiBagger: 5000,
    stopLoss: 2450,
    expectedUpsidePct: 76.1,
    listingGainsPct: 89.4,
    breakoutStatus: 'NEAR_PIVOT_ACCUMULATION',
    anchorLockinStatus: 'ABSORBED_STRONG',
    baseDurationWeeks: 8,
    baseDepthPct: 15.0,
    volumeSurgeRatio: 2.8,
    convictionScore: 96,
    institutionalOwnershipPct: 22.0,
    promoterHoldingPct: 71.0,
    fiiHoldingPct: 12.4,
    diiHoldingPct: 9.6,
    retailHoldingPct: 7.0,
    anchorSharesPercent: 15.0,
    anchorLockin30d: { expiryDate: '2023-08-27', status: 'EXPIRED', sharesPct: 7.5 },
    anchorLockin90d: { expiryDate: '2023-10-27', status: 'EXPIRED', sharesPct: 7.5 },
    anchorLockin180d: { expiryDate: '2024-01-27', status: 'EXPIRED', sharesPct: 0.0 },
    keyCatalysts: [
      'Official NVIDIA build partner for DGX supercomputing systems in India',
      'AI server order pipeline doubling every 6 months across Indian hyperscalers',
      'Indigenous supercomputing mission prime beneficiary'
    ],
    risks: [
      'GPU allocation lead times from chip suppliers',
      'Lumpy enterprise IT capex cycles'
    ],
    setupSummary: 'Tremendous 5.6x post-IPO compounder. High-tight consolidation handle breaking out towards ₹3,600+.'
  },
  {
    ticker: 'CYIENTDLM.NS',
    symbol: 'CYIENTDLM',
    companyName: 'Cyient DLM Ltd',
    sector: 'Aerospace & Defense Electronics',
    listingDate: '2023-07-10',
    ipoYear: 2023,
    daysSinceListing: 525,
    issuePrice: 265,
    listingPrice: 403,
    listingDayHigh: 427,
    currentPrice: 685,
    breakoutTriggerPrice: 720,
    target1: 880,
    targetMultiBagger: 1250,
    stopLoss: 590,
    expectedUpsidePct: 82.5,
    listingGainsPct: 52.1,
    breakoutStatus: 'BASE_CONSOLIDATION',
    anchorLockinStatus: 'ABSORBED_STRONG',
    baseDurationWeeks: 12,
    baseDepthPct: 18.0,
    volumeSurgeRatio: 2.2,
    convictionScore: 89,
    institutionalOwnershipPct: 34.0,
    promoterHoldingPct: 66.7,
    fiiHoldingPct: 15.2,
    diiHoldingPct: 18.8,
    retailHoldingPct: 4.3,
    anchorSharesPercent: 14.0,
    anchorLockin30d: { expiryDate: '2023-08-10', status: 'EXPIRED', sharesPct: 7.0 },
    anchorLockin90d: { expiryDate: '2023-10-10', status: 'EXPIRED', sharesPct: 7.0 },
    anchorLockin180d: { expiryDate: '2024-01-10', status: 'EXPIRED', sharesPct: 0.0 },
    keyCatalysts: [
      'High-reliability electronics manufacturing for defense and avionics (Thales, Bharat Electronics)',
      'New Mysuru and Hyderabad facility capacity addition ramp up',
      'Strong export mix shielding margins from domestic pricing pressure'
    ],
    risks: [
      'Extended aerospace qualification lead cycles',
      'Foreign exchange fluctuation exposure'
    ],
    setupSummary: '12-week rectangular base consolidation above ₹650. Volume drying up; pivot breakout at ₹720.'
  },
  {
    ticker: 'JSWINFRA.NS',
    symbol: 'JSWINFRA',
    companyName: 'JSW Infrastructure Ltd',
    sector: 'Ports & Marine Logistics',
    listingDate: '2023-10-03',
    ipoYear: 2023,
    daysSinceListing: 440,
    issuePrice: 119,
    listingPrice: 143,
    listingDayHigh: 155,
    currentPrice: 295,
    breakoutTriggerPrice: 320,
    target1: 390,
    targetMultiBagger: 550,
    stopLoss: 260,
    expectedUpsidePct: 86.4,
    listingGainsPct: 20.2,
    breakoutStatus: 'NEAR_PIVOT_ACCUMULATION',
    anchorLockinStatus: 'ABSORBED_STRONG',
    baseDurationWeeks: 10,
    baseDepthPct: 14.5,
    volumeSurgeRatio: 2.4,
    convictionScore: 91,
    institutionalOwnershipPct: 19.5,
    promoterHoldingPct: 84.8,
    fiiHoldingPct: 6.2,
    diiHoldingPct: 13.3,
    retailHoldingPct: 1.7,
    anchorSharesPercent: 12.5,
    anchorLockin30d: { expiryDate: '2023-11-03', status: 'EXPIRED', sharesPct: 6.25 },
    anchorLockin90d: { expiryDate: '2024-01-03', status: 'EXPIRED', sharesPct: 6.25 },
    anchorLockin180d: { expiryDate: '2024-04-03', status: 'EXPIRED', sharesPct: 0.0 },
    keyCatalysts: [
      'Second largest commercial port operator in India by cargo handling capacity',
      'Aggressive inorganic concession acquisitions (Navkar logistics, Tuticorin terminal)',
      'Long-term captive volume assurance from JSW Steel and JSW Energy'
    ],
    risks: [
      'Bulk cargo commodity cycle exposure (iron ore, coal)',
      'Tariff regulation policies under Major Port Authorities Act'
    ],
    setupSummary: '2.5x post-IPO compounding trajectory. Testing all-time-high pivot at ₹320 with volume expansion.'
  }
];

function computeAnchorLockinCountdown(lockin?: { expiryDate: string; status: 'EXPIRED' | 'IMMINENT' | 'PENDING'; sharesPct: number; daysRemaining?: number }): { expiryDate: string; status: 'EXPIRED' | 'IMMINENT' | 'PENDING'; sharesPct: number; daysRemaining?: number } | undefined {
  if (!lockin || !lockin.expiryDate) return lockin;
  const expiryTime = new Date(lockin.expiryDate).getTime();
  if (isNaN(expiryTime)) return lockin;
  const diffDays = Math.ceil((expiryTime - Date.now()) / (1000 * 60 * 60 * 24));
  let status: 'EXPIRED' | 'IMMINENT' | 'PENDING' = lockin.status;
  if (diffDays <= 0) {
    status = 'EXPIRED';
  } else if (diffDays <= 7) {
    status = 'IMMINENT';
  } else {
    status = 'PENDING';
  }
  return {
    ...lockin,
    status,
    daysRemaining: diffDays > 0 ? diffDays : 0,
  };
}

function computeDaysSinceListing(listingDate: string, fallbackDays: number): number {
  if (!listingDate) return fallbackDays;
  const d = new Date(listingDate).getTime();
  if (isNaN(d)) return fallbackDays;
  const days = Math.floor((Date.now() - d) / (1000 * 60 * 60 * 24));
  return days > 0 ? days : fallbackDays;
}

export function getPostIpoBreakouts(filters?: {
  status?: string;
  sector?: string;
  minScore?: number;
}): PostIpoResponse {
  let candidates = [...CURATED_POST_IPO_CANDIDATES];

  // Check if cache file exists on disk
  try {
    if (fs.existsSync(POST_IPO_CACHE_PATH)) {
      const fileData = fs.readFileSync(POST_IPO_CACHE_PATH, 'utf-8');
      const parsed = JSON.parse(fileData);
      if (Array.isArray(parsed.data) && parsed.data.length > 0) {
        candidates = parsed.data;
      }
    }
  } catch (err) {
    console.warn('Error reading post-IPO cache, using memory defaults:', err);
  }

  if (filters?.status && filters.status !== 'all') {
    candidates = candidates.filter(c => c.breakoutStatus.toLowerCase() === filters.status?.toLowerCase());
  }

  if (filters?.sector && filters.sector !== 'all') {
    candidates = candidates.filter(c => c.sector.toLowerCase().includes(filters.sector!.toLowerCase()));
  }

  if (filters?.minScore && filters.minScore > 0) {
    candidates = candidates.filter(c => c.convictionScore >= filters.minScore!);
  }

  const triggeredCount = candidates.filter(c => c.breakoutStatus === 'BREAKOUT_TRIGGERED').length;
  const settingUpCount = candidates.filter(c => c.breakoutStatus !== 'BREAKOUT_TRIGGERED').length;
  const avgWeeks = candidates.length > 0
    ? Math.round(candidates.reduce((acc, c) => acc + c.baseDurationWeeks, 0) / candidates.length)
    : 0;

  const absorbedCount = candidates.filter(c => c.anchorLockinStatus === 'ABSORBED_STRONG').length;
  const absorbedPct = candidates.length > 0 ? Math.round((absorbedCount / candidates.length) * 100) : 0;

  const totalGainsSum = candidates.reduce((acc, c) => {
    const cur = c.livePrice || c.currentPrice;
    return acc + ((cur - c.issuePrice) / c.issuePrice) * 100;
  }, 0);
  const avgTotalGainPct = candidates.length > 0 ? Math.round(totalGainsSum / candidates.length) : 0;

  const mappedCandidates = candidates.map(c => {
    const livePrice = c.livePrice || c.currentPrice;
    const daysSinceListing = computeDaysSinceListing(c.listingDate, c.daysSinceListing);
    const anchorLockin30d = computeAnchorLockinCountdown(c.anchorLockin30d);
    const anchorLockin90d = computeAnchorLockinCountdown(c.anchorLockin90d);
    const anchorLockin180d = computeAnchorLockinCountdown(c.anchorLockin180d);
    const prediction = c.differentiatedPrediction || calculatePostIpoPrediction({ ...c, livePrice });
    const isFresh15DaySurge = (daysSinceListing <= 60 || c.baseDurationWeeks <= 6) && (c.expectedUpsidePct >= 30 || c.breakoutStatus === 'BREAKOUT_TRIGGERED' || c.breakoutStatus === 'NEAR_PIVOT_ACCUMULATION');
    const surgeTarget15d = prediction.predictedTarget15d || Math.round(livePrice * 1.5);
    const surgeTarget15dPct = prediction.predictedCurrentToT15Pct || 50;
    return {
      ...c,
      daysSinceListing,
      anchorLockin30d,
      anchorLockin90d,
      anchorLockin180d,
      isFresh15DaySurge,
      surgeTarget15d,
      surgeTarget15dPct,
      differentiatedPrediction: prediction,
    };
  });

  return {
    success: true,
    count: mappedCandidates.length,
    generatedAt: new Date().toISOString(),
    isLiveFeed: mappedCandidates.some(c => c.isLiveFeed),
    marketStats: {
      averageBaseDurationWeeks: avgWeeks,
      breakoutsTriggeredCount: triggeredCount,
      settingUpCount: settingUpCount,
      absorbedAnchorOverhangPct: absorbedPct,
      averageTotalGainsSinceIpoPct: avgTotalGainPct,
    },
    data: mappedCandidates,
  };
}

export async function enrichWithLiveQuotes(candidates: PostIpoCandidate[]): Promise<PostIpoCandidate[]> {
  const rows = await refreshStockRows(candidates);
  return rows.map(candidate => {
    const livePrice = candidate.currentPrice;
    const dayChangePct = candidate.changePercent;
    const expectedUpsidePct = Number(((candidate.targetMultiBagger / livePrice - 1) * 100).toFixed(1));
    const breakoutStatus = livePrice >= candidate.breakoutTriggerPrice ? 'BREAKOUT_TRIGGERED'
      : livePrice >= candidate.breakoutTriggerPrice * 0.94 ? 'NEAR_PIVOT_ACCUMULATION' : 'BASE_CONSOLIDATION';

    const daysSinceListing = computeDaysSinceListing(candidate.listingDate, candidate.daysSinceListing);
    const anchorLockin30d = computeAnchorLockinCountdown(candidate.anchorLockin30d);
    const anchorLockin90d = computeAnchorLockinCountdown(candidate.anchorLockin90d);
    const anchorLockin180d = computeAnchorLockinCountdown(candidate.anchorLockin180d);

    const enrichedCandidate: PostIpoCandidate = {
      ...candidate,
      livePrice,
      dayChangePct,
      expectedUpsidePct,
      breakoutStatus,
      daysSinceListing,
      anchorLockin30d,
      anchorLockin90d,
      anchorLockin180d,
      isLiveFeed: candidate.quoteStatus === 'recent',
      lastUpdated: candidate.quoteAsOf,
    };

    const prediction = calculatePostIpoPrediction(enrichedCandidate);
    const isFresh15DaySurge = (daysSinceListing <= 60 || candidate.baseDurationWeeks <= 6) && (expectedUpsidePct >= 30 || breakoutStatus === 'BREAKOUT_TRIGGERED' || breakoutStatus === 'NEAR_PIVOT_ACCUMULATION');
    const surgeTarget15d = prediction.predictedTarget15d || Math.round(livePrice * 1.5);
    const surgeTarget15dPct = prediction.predictedCurrentToT15Pct || 50;

    return {
      ...enrichedCandidate,
      isFresh15DaySurge,
      surgeTarget15d,
      surgeTarget15dPct,
      differentiatedPrediction: prediction,
    };
  });
}

export async function getPostIpoBreakoutsAsync(filters?: {
  status?: string;
  sector?: string;
  minScore?: number;
  live?: boolean;
}): Promise<PostIpoResponse> {
  const baseResult = getPostIpoBreakouts({
    sector: filters?.sector,
    minScore: filters?.minScore,
  });

  // Enrich with live market data from exchange
  const observed = await enrichWithLiveQuotes(baseResult.data);
  const liveData = filters?.status ? observed.filter(row => row.breakoutStatus === filters.status) : observed;
  const triggeredCount = liveData.filter(c => c.breakoutStatus === 'BREAKOUT_TRIGGERED').length;
  const settingUpCount = liveData.filter(c => c.breakoutStatus !== 'BREAKOUT_TRIGGERED').length;

  return {
    ...baseResult,
    count: liveData.length,
    isLiveFeed: liveData.some(row => row.isLiveFeed),
    liveSyncedAt: new Date().toISOString(),
    marketStats: {
      ...baseResult.marketStats,
      breakoutsTriggeredCount: triggeredCount,
      settingUpCount: settingUpCount,
    },
    data: liveData,
  };
}

export function savePostIpoCache(candidates: PostIpoCandidate[] = CURATED_POST_IPO_CANDIDATES): void {
  try {
    const dir = path.dirname(POST_IPO_CACHE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const payload: PostIpoResponse = {
      success: true,
      count: candidates.length,
      generatedAt: new Date().toISOString(),
      isLiveFeed: candidates.some(c => c.isLiveFeed),
      marketStats: {
        averageBaseDurationWeeks: 9,
        breakoutsTriggeredCount: candidates.filter(c => c.breakoutStatus === 'BREAKOUT_TRIGGERED').length,
        settingUpCount: candidates.filter(c => c.breakoutStatus !== 'BREAKOUT_TRIGGERED').length,
      },
      data: candidates,
    };
    fs.writeFileSync(POST_IPO_CACHE_PATH, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save post-IPO cache:', err);
  }
}
