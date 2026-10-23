import { getAxionProjectRoot } from './project-root';
import fs from 'fs';
import { refreshStockRows } from './live-stock-rows';
import path from 'path';
import { MultiBaggerCandidate, MultiBaggerResponse } from './multibagger-types';

const MULTIBAGGER_CACHE_PATH = path.join(getAxionProjectRoot(), 'data', 'stock-ai', 'multibagger_predictions.json');

// High-conviction multi-bagger candidates calibrated against Peter Lynch & CANSLIM 6-Pillars
const CURATED_MULTIBAGGER_PICKS: MultiBaggerCandidate[] = [
  {
    "ticker": "CYIENTDLM.NS",
    "symbol": "CYIENTDLM",
    "name": "Cyient DLM Limited",
    "sector": "EMS & Aerospace Electronics",
    "marketCapCategory": "Small-Cap (₹1,500–₹10,000 Cr)",
    "marketCapCr": 5400,
    "currentPrice": 680,
    "multiBaggerScore": 95,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 19.8,
        "roce": 24.2,
        "passed": true,
        "verdict": "High-margin aerospace design and critical defense electronics manufacturing."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 42.5,
        "profitGrowth3Y": 58.2,
        "passed": true,
        "verdict": "Order book backlog exceeding ₹2,500 Cr with Boeing and Honeywell key accounts."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.12,
        "interestCoverage": 18.5,
        "passed": true,
        "verdict": "Virtually zero long-term debt post-IPO recapitalization."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 38.5,
        "fiiQoQChange": 3.2,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 48,
        "pegRatio": 0.88,
        "passed": true,
        "verdict": "PEG under 1.0 indicates substantial valuation runway given 50%+ earnings CAGR."
      },
      "technicalStage": {
        "stage": "Stage-2 Cup & Handle Breakout",
        "support200D": 590,
        "breakoutVolumeRatio": 3.2,
        "passed": true,
        "verdict": "Breakout above ₹650 listing consolidation with high institutional volume."
      }
    },
    "keyMoats": [
      "Sole-source supplier for specialized defense avionics & cockpit displays.",
      "Strict AS9100 aerospace certification barriers to entry.",
      "Parent Cyient global client relationships and co-engineering capabilities."
    ],
    "catalysts": [
      "Expanding Mysore & Hyderabad manufacturing plants for global aerospace exports.",
      "Make-in-India defense indigenization mandates for radar avionics."
    ],
    "risks": [
      "Customer concentration in top 3 aerospace tier-1 OEMs.",
      "Global electronic component lead-time cycles."
    ],
    "investmentThesis": "Cyient DLM is an aerospace-grade EMS pure-play poised for a 3x-5x compounding trajectory as global defense budgets expand and commercial aviation supply chains re-shore to India.",
    "entryPrice": 673,
    "target1Y": 1360,
    "target3Y": 2380,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 544
  },
  {
    "ticker": "ORIENTTECH.NS",
    "symbol": "ORIENTTECH",
    "name": "Orient Technologies Limited",
    "sector": "IT Infrastructure & Cloud AI",
    "marketCapCategory": "Micro-Cap (< ₹1,500 Cr)",
    "marketCapCr": 1250,
    "currentPrice": 300,
    "multiBaggerScore": 93,
    "convictionTier": "HIGH_GROWTH",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 28.5,
        "roce": 32.4,
        "passed": true,
        "verdict": "Industry-leading asset turnover and software-defined cloud solutions."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 34.2,
        "profitGrowth3Y": 46.8,
        "passed": true,
        "verdict": "Rapid expansion in enterprise cloud migration and banking IT automation."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.08,
        "interestCoverage": 24.0,
        "passed": true,
        "verdict": "Clean balance sheet with zero financial leverage."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 22.4,
        "fiiQoQChange": 2.1,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 26,
        "pegRatio": 0.65,
        "passed": true,
        "verdict": "Extremely attractive PEG of 0.65 with high growth at reasonable price."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 240,
        "breakoutVolumeRatio": 2.8,
        "passed": true,
        "verdict": "Stage-1 base accumulation breakout above ₹290 on 2.8x volume."
      }
    },
    "keyMoats": [
      "Deep tier-1 partnerships with Cisco, Dell, and VMware.",
      "High-margin cloud data center transformation expertise.",
      "Long-term public sector and BFSI client retention exceeding 92%."
    ],
    "catalysts": [
      "Expansion into AI data center infrastructure and private cloud deployments.",
      "Large BFSI digitisation capex cycle in domestic market."
    ],
    "risks": [
      "Hardware supplier warranty and price fluctuations.",
      "Competitive bidding pressure on government contracts."
    ],
    "investmentThesis": "Micro-cap IT pure-play growing at 35%+ with 30%+ ROCE, priced at just 26x P/E. Ideal micro-cap rerating candidate for 3x+ upside.",
    "entryPrice": 297,
    "target1Y": 600,
    "target3Y": 1050,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 240
  },
  {
    "ticker": "SHAILY.NS",
    "symbol": "SHAILY",
    "name": "Shaily Engineering Plastics Limited",
    "sector": "Precision Medical Devices & Injectors",
    "marketCapCategory": "Small-Cap (₹1,500–₹10,000 Cr)",
    "marketCapCr": 2400,
    "currentPrice": 1120,
    "multiBaggerScore": 94,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 22.6,
        "roce": 25.8,
        "passed": true,
        "verdict": "High-value medical devices and complex drug delivery pen devices."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 28.4,
        "profitGrowth3Y": 48.2,
        "passed": true,
        "verdict": "GLP-1 and insulin pen delivery contracts ramping with global pharma giants."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.22,
        "interestCoverage": 12.5,
        "passed": true,
        "verdict": "Low leverage with expanding operating cash flows."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 26.8,
        "fiiQoQChange": 2.6,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 42,
        "pegRatio": 0.95,
        "passed": true,
        "verdict": "Medical device rerating runway with massive margin expansion."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 880,
        "breakoutVolumeRatio": 2.5,
        "passed": true,
        "verdict": "All-time-high breakout above ₹1,050 base."
      }
    },
    "keyMoats": [
      "FDA/CE approved cleanroom facilities for medical drug delivery devices.",
      "IP-protected proprietary pen injector platforms.",
      "Exclusive global contracts with global healthcare multinationals."
    ],
    "catalysts": [
      "Commercial scale-up of diabetes and obesity GLP-1 auto-injector supplies.",
      "New UK and US healthcare regulatory approvals."
    ],
    "risks": [
      "Raw polymer price swings.",
      "Regulatory audit timelines for medical device plants."
    ],
    "investmentThesis": "High-entry-barrier medical device manufacturer transitioning from industrial plastics to complex drug delivery systems. Poised for 3x compounding over 3 years.",
    "entryPrice": 1108,
    "target1Y": 2240,
    "target3Y": 3920,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 896
  },
  {
    "ticker": "KAYNES.NS",
    "symbol": "KAYNES",
    "name": "Kaynes Technology India Limited",
    "sector": "High-Tech Electronics & EMS",
    "marketCapCategory": "Mid-Cap (₹10,000–₹35,000 Cr)",
    "marketCapCr": 28450,
    "currentPrice": 4850,
    "multiBaggerScore": 94,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 22.4,
        "roce": 26.8,
        "passed": true,
        "verdict": "Super-normal return on capital driven by high-complexity aerospace & defense PCBAs."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 48.6,
        "profitGrowth3Y": 62.4,
        "passed": true,
        "verdict": "Order book backlog expanding at 55%+ CAGR fueled by Semiconductor OSAT facility capex and Railway signaling."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.18,
        "interestCoverage": 14.8,
        "passed": true,
        "verdict": "Virtually debt-free with pristine operating cash flows and strong working capital cycle management."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 34.2,
        "fiiQoQChange": 2.85,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 58,
        "pegRatio": 0.92,
        "passed": true,
        "verdict": "PEG under 1.0 confirms hyper-growth justifies current earnings multiple with massive operating leverage ahead."
      },
      "technicalStage": {
        "stage": "Stage-2 Cup & Handle Breakout",
        "support200D": 4120,
        "breakoutVolumeRatio": 3.4,
        "passed": true,
        "verdict": "Clean Stage-2 base breakout on 3.4x average institutional weekly volume clearing all previous overhead supply."
      }
    },
    "keyMoats": [
      "Proprietary OSAT & advanced chip packaging capabilities.",
      "High switching costs in Defense, Aerospace, and MedTech segments.",
      "Order backlog exceeding ₹5,000 Cr with 18+ month revenue visibility."
    ],
    "catalysts": [
      "Commissioning of Sanand semiconductor packaging plant.",
      "Indian Railway Kavach 4.0 anti-collision system rollout.",
      "Global OEM shift from China+1 to India for critical electronics."
    ],
    "risks": [
      "Raw material lead-time delays for imported semiconductor substrates.",
      "General market valuation compression during systemic interest rate hikes."
    ],
    "investmentThesis": "Kaynes sits at the epicenter of India’s semiconductor and electronics sovereignty. With 50%+ top-line growth and a pristine balance sheet, it mirrors early-stage compounders that multiplied 5x-10x in past industrial cycles.",
    "entryPrice": 4801.5,
    "target1Y": 9700,
    "target3Y": 16975,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 3880
  },
  {
    "ticker": "DATAPATTNS.NS",
    "symbol": "DATAPATTNS",
    "name": "Data Patterns (India) Limited",
    "sector": "Defense & Aerospace Electronics",
    "marketCapCategory": "Mid-Cap (₹10,000–₹35,000 Cr)",
    "marketCapCr": 15800,
    "currentPrice": 2829.2,
    "multiBaggerScore": 92,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 21.8,
        "roce": 25.5,
        "passed": true,
        "verdict": "Outstanding EBITDA margins of 38-42%, among the highest in global defense avionics."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 38.2,
        "profitGrowth3Y": 45.1,
        "passed": true,
        "verdict": "Consistent 35%+ revenue expansion with escalating indigenous radar and electronic warfare contracts."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.05,
        "interestCoverage": 28.5,
        "passed": true,
        "verdict": "Net debt-free balance sheet with over ₹450 Cr liquid cash reserves supporting self-funded R&D."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 28.5,
        "fiiQoQChange": 1.95,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 52,
        "pegRatio": 1.12,
        "passed": true,
        "verdict": "High barrier-to-entry IP moats grant sustained premium valuation multiples as defense budgets expand."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 2400,
        "breakoutVolumeRatio": 2.8,
        "passed": true,
        "verdict": "Consolidating in a high-tight flag formation above rising 50-day and 200-day SMAs with dry seller volume."
      }
    },
    "keyMoats": [
      "Full-spectrum in-house design from antenna to radar processors.",
      "Selected vendor for LCA Tejas Mark 1A and BrahMos missile guidance.",
      "Monopolistic positioning in specific electronic warfare receiver modules."
    ],
    "catalysts": [
      "CCS clearance for next-generation radar systems.",
      "Export clearances to Southeast Asia and Middle Eastern defense partners.",
      "Rapid ramp-up of new Chennai manufacturing complex."
    ],
    "risks": [
      "Lumpy government procurement timeline cycles.",
      "Working capital intensity typical of large defense milestones."
    ],
    "investmentThesis": "Data Patterns is one of the rare pure-play defense IP designers with 40%+ operating margins and zero debt. As India replaces foreign defense avionics with domestic systems, Data Patterns has a multi-year runway for 3x-4x compounding.",
    "entryPrice": 2800.91,
    "target1Y": 5658.4,
    "target3Y": 9902.2,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 2263.36
  },
  {
    "ticker": "NETWEB.NS",
    "symbol": "NETWEB",
    "name": "Netweb Technologies India Limited",
    "sector": "AI Cloud & Supercomputing",
    "marketCapCategory": "Mid-Cap (₹10,000–₹35,000 Cr)",
    "marketCapCr": 16400,
    "currentPrice": 2890,
    "multiBaggerScore": 93,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 32.5,
        "roce": 36.2,
        "passed": true,
        "verdict": "Industry-leading ROE exceeding 30% driven by high-margin supercomputing architectures."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 65.4,
        "profitGrowth3Y": 78.1,
        "passed": true,
        "verdict": "Explosive enterprise AI demand with order pipeline growing at over 70% CAGR."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.08,
        "interestCoverage": 22,
        "passed": true,
        "verdict": "Virtually zero long-term debt; working capital supported by customer advances."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 24.8,
        "fiiQoQChange": 3.1,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 65,
        "pegRatio": 0.85,
        "passed": true,
        "verdict": "Sub-1.0 PEG ratio reflecting hyper-growth trajectory in sovereign AI compute."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 2350,
        "breakoutVolumeRatio": 3.1,
        "passed": true,
        "verdict": "Stage-2 institutional consolidation clearing ascending channel resistance."
      }
    },
    "keyMoats": [
      "India Elite partner status for NVIDIA Grace Hopper AI superchip systems.",
      "Proprietary Tyrone HPC software stack.",
      "Local manufacturing compliance for India AI Mission sovereign tenders."
    ],
    "catalysts": [
      "India AI Mission ₹10,300 Cr sovereign compute procurement allocations.",
      "Hyperscaler private AI cloud deployments across BFSI and pharma.",
      "Capacity expansion of new Faridabad advanced manufacturing unit."
    ],
    "risks": [
      "NVIDIA GPU allocation lead-time constraints.",
      "Lumpy quarterly deliveries for government compute projects."
    ],
    "investmentThesis": "Netweb is India’s premier pure-play OEM for generative AI server clusters and supercomputers. With sovereign AI spending accelerating, Netweb possesses a multi-year secular compounding tailwind.",
    "entryPrice": 2861.1,
    "target1Y": 5780,
    "target3Y": 10115,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 2312
  },
  {
    "ticker": "BEL.NS",
    "symbol": "BEL",
    "name": "Bharat Electronics Limited",
    "sector": "Defense & Aerospace Electronics",
    "marketCapCategory": "Large-Cap (> ₹35,000 Cr)",
    "marketCapCr": 215000,
    "currentPrice": 295,
    "multiBaggerScore": 91,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 26.4,
        "roce": 34.8,
        "passed": true,
        "verdict": "Pristine capital returns with negative net working capital and zero debt."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 18.5,
        "profitGrowth3Y": 28.2,
        "passed": true,
        "verdict": "Order book at historic record high of ₹76,000+ Cr, providing 3.5x annual revenue visibility."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0,
        "interestCoverage": 120,
        "passed": true,
        "verdict": "Zero debt balance sheet with ₹8,000+ Cr in liquid treasury reserves."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 42.5,
        "fiiQoQChange": 1.8,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 42,
        "pegRatio": 1.45,
        "passed": true,
        "verdict": "Valuation supported by structural defense indigenization mandates and export pipeline."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 260,
        "breakoutVolumeRatio": 2.2,
        "passed": true,
        "verdict": "Bullish consolidation along 50-day EMA with steady institutional accumulation."
      }
    },
    "keyMoats": [
      "Dominant 55%+ market share in Indian defense electronics.",
      "Preferred partner for missile defense radars, naval sonars, and electronic voting systems.",
      "Unmatched engineering talent pool with deep defense PSU integration."
    ],
    "catalysts": [
      "Quick Reaction Surface-to-Air Missile (QRSAM) mega-orders.",
      "Export contracts to friendly foreign nations for surveillance radars.",
      "Non-defense diversification into civil aviation, EV chargers, and medical devices."
    ],
    "risks": [
      "Delays in platform delivery by aircraft/shipbuilding integrators.",
      "Component price inflation on imported specialized microchips."
    ],
    "investmentThesis": "BEL is the defense titan of India with zero debt, 30%+ ROCE, and a ₹76,000 Cr order backlog. Secular defense modernization guarantees persistent multi-year compound earnings growth.",
    "entryPrice": 292.05,
    "target1Y": 590,
    "target3Y": 1032.5,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 236
  },
  {
    "ticker": "HAL.NS",
    "symbol": "HAL",
    "name": "Hindustan Aeronautics Limited",
    "sector": "Defense & Aerospace Electronics",
    "marketCapCategory": "Large-Cap (> ₹35,000 Cr)",
    "marketCapCr": 298000,
    "currentPrice": 4450,
    "multiBaggerScore": 93,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 28.6,
        "roce": 38.4,
        "passed": true,
        "verdict": "Stupendous capital productivity with industry-leading ROE and zero external debt."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 14.8,
        "profitGrowth3Y": 34.6,
        "passed": true,
        "verdict": "Order backlog exceeding ₹1,20,000 Cr, ensuring over 4 years of guaranteed revenue runway."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0,
        "interestCoverage": 150,
        "passed": true,
        "verdict": "Completely debt-free fortress balance sheet with ₹25,000+ Cr in cash and bank deposits."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 38.6,
        "fiiQoQChange": 2.4,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 36,
        "pegRatio": 1.15,
        "passed": true,
        "verdict": "Attractive P/E relative to 30%+ ROE and multi-decade sovereign fighter jet procurement cycle."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 3950,
        "breakoutVolumeRatio": 2.6,
        "passed": true,
        "verdict": "Resuming primary uptrend above 50-day moving average following healthy consolidation."
      }
    },
    "keyMoats": [
      "Sole domestic designer and manufacturer of military fighter jets and helicopters.",
      "Exclusive supplier of Tejas Mark 1A, Prachand LCH, and ALH Dhruv platforms.",
      "High-margin repair, overhaul, and spares annuity stream accounting for 50%+ of profits."
    ],
    "catalysts": [
      "Upcoming 97 additional Tejas Mark 1A contract finalization.",
      "GE F414 jet engine technology transfer and domestic manufacturing.",
      "Export interest from Southeast Asia, Africa, and South America."
    ],
    "risks": [
      "Engine supply schedule dependency on foreign partners.",
      "Capacity bottlenecks at Nashik and Bengaluru manufacturing lines."
    ],
    "investmentThesis": "HAL possesses a total monopoly on India’s military aviation platform manufacturing with over ₹1.2 lakh crore order visibility, negative debt, and unmatched ROCE.",
    "entryPrice": 4405.5,
    "target1Y": 8900,
    "target3Y": 15575,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 3560
  },
  {
    "ticker": "MAZDOCK.NS",
    "symbol": "MAZDOCK",
    "name": "Mazagon Dock Shipbuilders Limited",
    "sector": "Defense & Aerospace Electronics",
    "marketCapCategory": "Large-Cap (> ₹35,000 Cr)",
    "marketCapCr": 88500,
    "currentPrice": 4390,
    "multiBaggerScore": 92,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 36.8,
        "roce": 48.5,
        "passed": true,
        "verdict": "Astonishing 48%+ ROCE driven by massive negative working capital advances on submarine contracts."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 28.5,
        "profitGrowth3Y": 48.2,
        "passed": true,
        "verdict": "Net profit compounded at 48% CAGR over 3 years on high-margin naval destroyer builds."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0,
        "interestCoverage": 180,
        "passed": true,
        "verdict": "Zero debt with more than ₹14,000 Cr in liquid cash and investments generating massive other income."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 18.2,
        "fiiQoQChange": 2.9,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 38,
        "pegRatio": 0.95,
        "passed": true,
        "verdict": "Undervalued given 40%+ return on equity and generational naval submarine modernization."
      },
      "technicalStage": {
        "stage": "Stage-2 Cup & Handle Breakout",
        "support200D": 3800,
        "breakoutVolumeRatio": 3.5,
        "passed": true,
        "verdict": "Massive volume breakout from multi-month consolidation base above 200 SMA."
      }
    },
    "keyMoats": [
      "Only shipyard capable of building stealth destroyers and conventional diesel-electric submarines.",
      "Scorpene Kalvari-class submarine manufacturing mastery.",
      "Deep water berths and state-of-the-art submarine wet basin in Mumbai."
    ],
    "catalysts": [
      "Project 75-I mega-tender for 6 next-gen submarines with Air Independent Propulsion (AIP).",
      "Follow-on orders for 3 additional Scorpene-class submarines.",
      "Next-generation destroyer and frigate construction programs."
    ],
    "risks": [
      "Long gestation and delivery milestones subject to naval sea acceptance trials.",
      "Foreign vendor collaboration negotiations."
    ],
    "investmentThesis": "Mazagon Dock is India’s sole premier submarine shipbuilder, generating 48% ROCE with ₹14,000 Cr cash and a decade of unassailable defense warship construction contracts.",
    "entryPrice": 4346.1,
    "target1Y": 8780,
    "target3Y": 15365,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 3512
  },
  {
    "ticker": "COCHINSHIP.NS",
    "symbol": "COCHINSHIP",
    "name": "Cochin Shipyard Limited",
    "sector": "Defense & Aerospace Electronics",
    "marketCapCategory": "Mid-Cap (₹10,000–₹35,000 Cr)",
    "marketCapCr": 44200,
    "currentPrice": 1680,
    "multiBaggerScore": 90,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 24.2,
        "roce": 32.5,
        "passed": true,
        "verdict": "Super-efficient shipyard asset utilization with premier commercial ship repair margins."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 22.4,
        "profitGrowth3Y": 42.1,
        "passed": true,
        "verdict": "Commercial green vessel exports surging alongside domestic anti-submarine shallow water craft builds."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.02,
        "interestCoverage": 45,
        "passed": true,
        "verdict": "Practically debt-free with over ₹4,000 Cr in liquid treasury reserves."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 21.5,
        "fiiQoQChange": 2.1,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 44,
        "pegRatio": 1.18,
        "passed": true,
        "verdict": "Premium multiple justified by new dry dock commercialization and aircraft carrier repeat orders."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 1420,
        "breakoutVolumeRatio": 2.9,
        "passed": true,
        "verdict": "Holding higher swing lows with institutional volume accumulation."
      }
    },
    "keyMoats": [
      "Built India’s first indigenous aircraft carrier (INS Vikrant).",
      "Largest ship repair capability in South Asia.",
      "International leadership in autonomous electric and hydrogen vessel construction for Europe."
    ],
    "catalysts": [
      "Commissioning of ₹2,800 Cr new dry dock and International Ship Repair Facility (ISRF).",
      "IAC-2 repeat indigenous aircraft carrier order pipeline.",
      "European green cargo vessel export orders."
    ],
    "risks": [
      "Steel raw material cost fluctuations on fixed-price contracts.",
      "Timing of big-ticket naval ship delivery milestones."
    ],
    "investmentThesis": "Cochin Shipyard is expanding capacity by 100% with its brand-new deep dry dock and ISRF repair facility, capitalizing on secular naval shipbuilding and high-margin European commercial vessel exports.",
    "entryPrice": 1663.2,
    "target1Y": 3360,
    "target3Y": 5880,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 1344
  },
  {
    "ticker": "SOLARINDS.NS",
    "symbol": "SOLARINDS",
    "name": "Solar Industries India Limited",
    "sector": "Defense & Industrial Explosives",
    "marketCapCategory": "Large-Cap (> ₹35,000 Cr)",
    "marketCapCr": 94500,
    "currentPrice": 10450,
    "multiBaggerScore": 91,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 27.5,
        "roce": 31.8,
        "passed": true,
        "verdict": "Exceptional capital efficiency in high-barrier defense propellants and mining explosives."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 34.2,
        "profitGrowth3Y": 38.6,
        "passed": true,
        "verdict": "Defense revenue share surging from 5% to 25% with weaponized drone and pinaka rocket orders."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.35,
        "interestCoverage": 14.5,
        "passed": true,
        "verdict": "Conservative debt ratio with rapid deleveraging from operating cash flow generation."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 32.4,
        "fiiQoQChange": 1.6,
        "passed": true,
        "verdict": "STEADY_INFLOW"
      },
      "valuationRunway": {
        "peRatio": 62,
        "pegRatio": 1.45,
        "passed": true,
        "verdict": "High multiples supported by oligopolistic defense munitions and rocket propulsion moats."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 9100,
        "breakoutVolumeRatio": 2.4,
        "passed": true,
        "verdict": "Consistent long-term compounder printing fresh all-time highs on steady volume."
      }
    },
    "keyMoats": [
      "World’s largest manufacturer of industrial explosives and detonators.",
      "Exclusive private producer of warheads for Pinaka rockets and BrahMos missiles.",
      "Proprietary loitering munition (Nagastra-1) and drone payload technology."
    ],
    "catalysts": [
      "Mega Pinaka rocket export orders to European and Asian defense forces.",
      "Defense contribution reaching 30%+ of total top-line.",
      "Secular infrastructure capex and Coal India mining volume expansion."
    ],
    "risks": [
      "Ammonium nitrate input cost fluctuations.",
      "Stringent regulatory and environmental licensing oversight."
    ],
    "investmentThesis": "Solar Industries combines a domestic monopoly in industrial explosives with high-growth, high-margin defense munitions and loitering drones, creating a compounding powerhouse.",
    "entryPrice": 10345.5,
    "target1Y": 20900,
    "target3Y": 36575,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 8360
  },
  {
    "ticker": "SUZLON.NS",
    "symbol": "SUZLON",
    "name": "Suzlon Energy Limited",
    "sector": "Clean Energy & Renewables",
    "marketCapCategory": "Large-Cap (> ₹35,000 Cr)",
    "marketCapCr": 72000,
    "currentPrice": 53,
    "multiBaggerScore": 89,
    "convictionTier": "HIGH_GROWTH",
    "pillarsPassedCount": 5,
    "pillars": {
      "capitalEfficiency": {
        "roe": 25.1,
        "roce": 24.3,
        "passed": true,
        "verdict": "Stunning turnaround with ROE recovering past 25% post balance-sheet recapitalization."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 28.4,
        "profitGrowth3Y": 88.5,
        "passed": true,
        "verdict": "Record order book of over 4.5 GW (largest in company history), ensuring 2+ years of visibility."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.12,
        "interestCoverage": 9.4,
        "passed": true,
        "verdict": "Net debt-free turnaround from previous distress, eliminating historical interest drags."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 31.8,
        "fiiQoQChange": 3.4,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 42,
        "pegRatio": 0.78,
        "passed": true,
        "verdict": "Operating leverage on 3.x MW turbine series creates explosive earnings outpacing P/E."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 44,
        "breakoutVolumeRatio": 3.2,
        "passed": true,
        "verdict": "Multi-year turnaround base breakout with massive institutional fund accumulation."
      }
    },
    "keyMoats": [
      "Highest installed wind energy capacity in India with 14.5+ GW footprint.",
      "Lucrative Operation & Maintenance (OMS) cash cow business with 97%+ fleet availability.",
      "Technologically superior 3.14 MW turbine platform with higher plant load factors."
    ],
    "catalysts": [
      "Commercial and Industrial (C&I) green energy transition mandating wind-solar hybrid.",
      "India target of 500 GW non-fossil capacity by 2030 requiring 10 GW annual wind additions.",
      "Operating margin expansion toward 18-20% as new 3.x MW turbines scale."
    ],
    "risks": [
      "Execution bottlenecks around transmission grid evacuation connectivity.",
      "Right-of-way and land acquisition hurdles in wind-rich states."
    ],
    "investmentThesis": "Suzlon has transformed from a debt-ridden struggler into a net cash balance sheet titan commanding a record 4.5 GW order book, poised for hyper-compounding in India’s green energy boom.",
    "entryPrice": 52.47,
    "target1Y": 106,
    "target3Y": 185.5,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 42.4
  },
  {
    "ticker": "PREMIERENE.NS",
    "symbol": "PREMIERENE",
    "name": "Premier Energies Limited",
    "sector": "Clean Energy & Renewables",
    "marketCapCategory": "Mid-Cap (₹10,000–₹35,000 Cr)",
    "marketCapCr": 48500,
    "currentPrice": 1080,
    "multiBaggerScore": 92,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 38.2,
        "roce": 44.5,
        "passed": true,
        "verdict": "Industry-best capital efficiency driven by advanced TOPCon solar cell manufacturing."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 92,
        "profitGrowth3Y": 140,
        "passed": true,
        "verdict": "Triple-digit earnings expansion as domestic solar module procurement rules take full effect."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.28,
        "interestCoverage": 12.5,
        "passed": true,
        "verdict": "Comfortable solvency metrics supported by IPO proceeds and robust operational cash flows."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 26.5,
        "fiiQoQChange": 4.2,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 45,
        "pegRatio": 0.65,
        "passed": true,
        "verdict": "Sub-0.7 PEG ratio highlights severe mispricing relative to 100%+ profit compounding."
      },
      "technicalStage": {
        "stage": "High-Tight Flag",
        "support200D": 850,
        "breakoutVolumeRatio": 4.1,
        "passed": true,
        "verdict": "High-tight flag consolidation post-IPO listing with sustained institutional absorption."
      }
    },
    "keyMoats": [
      "India’s second largest integrated solar cell and module manufacturer.",
      "Early mover in high-efficiency N-Type TOPCon cell technology.",
      "ALMM (Approved List of Module Manufacturers) sovereign protection against cheap imports."
    ],
    "catalysts": [
      "Scale-up of new 1 GW TOPCon cell and 1 GW module facilities.",
      "PM Surya Ghar Muft Bijli Yojana (10 million rooftop solar installations).",
      "Surging US exports capitalizing on tariffs on Chinese solar equipment."
    ],
    "risks": [
      "Polysilicon raw wafer price swings.",
      "Tariff policy shifts in export markets."
    ],
    "investmentThesis": "Premier Energies is the purest domestic manufacturing beneficiary of India’s mandatory solar indigenization and rooftop solar revolution, compounding earnings at over 100% CAGR.",
    "entryPrice": 1069.2,
    "target1Y": 2160,
    "target3Y": 3780,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 864
  },
  {
    "ticker": "WAAREEENER.NS",
    "symbol": "WAAREEENER",
    "name": "Waaree Energies Limited",
    "sector": "Clean Energy & Renewables",
    "marketCapCategory": "Large-Cap (> ₹35,000 Cr)",
    "marketCapCr": 82000,
    "currentPrice": 2850,
    "multiBaggerScore": 93,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 34.5,
        "roce": 41.2,
        "passed": true,
        "verdict": "Dominant market share leader generating world-class capital returns on solar module production."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 75,
        "profitGrowth3Y": 110,
        "passed": true,
        "verdict": "Unmatched 20 GW order book backlog supplying major US and domestic solar utilities."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.15,
        "interestCoverage": 18,
        "passed": true,
        "verdict": "Pristine balance sheet with zero net debt and strong working capital management."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 29.8,
        "fiiQoQChange": 3.5,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 42,
        "pegRatio": 0.72,
        "passed": true,
        "verdict": "Attractive valuation given 13.3 GW operational capacity expanding to 20 GW."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 2400,
        "breakoutVolumeRatio": 3.8,
        "passed": true,
        "verdict": "Post-IPO accumulation base breakout supported by heavy domestic institutional buying."
      }
    },
    "keyMoats": [
      "India’s largest solar module manufacturer with 13.3 GW active capacity.",
      "Over 40% share of Indian solar module exports to the United States.",
      "Backward integration into 5.4 GW solar cell manufacturing."
    ],
    "catalysts": [
      "US manufacturing plant commissioning in Texas.",
      "Scale-up of backward integrated solar ingot and wafer capacities.",
      "Massive order inflows from utility scale solar developers in India."
    ],
    "risks": [
      "Changes to US anti-dumping and Uyghur Forced Labor Prevention Act (UFLPA) enforcement.",
      "Global solar panel supply-demand cycles."
    ],
    "investmentThesis": "Waaree Energies is India’s solar champion with an unbeatable 13+ GW operational scale, multi-year order books, and high-margin US export dominance.",
    "entryPrice": 2821.5,
    "target1Y": 5700,
    "target3Y": 9975,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 2280
  },
  {
    "ticker": "INOXWIND.NS",
    "symbol": "INOXWIND",
    "name": "Inox Wind Limited",
    "sector": "Clean Energy & Renewables",
    "marketCapCategory": "Mid-Cap (₹10,000–₹35,000 Cr)",
    "marketCapCr": 28500,
    "currentPrice": 215,
    "multiBaggerScore": 88,
    "convictionTier": "HIGH_GROWTH",
    "pillarsPassedCount": 5,
    "pillars": {
      "capitalEfficiency": {
        "roe": 20.5,
        "roce": 22.8,
        "passed": true,
        "verdict": "Dramatic operational turnaround following complete balance sheet deleveraging."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 45,
        "profitGrowth3Y": 95,
        "passed": true,
        "verdict": "Order book expanding toward 3.2 GW with high execution momentum on 3 MW turbines."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.1,
        "interestCoverage": 11,
        "passed": true,
        "verdict": "Promoter capital infusion and QIP achieved net interest-bearing debt reduction to zero."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 22.4,
        "fiiQoQChange": 3.2,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 36,
        "pegRatio": 0.82,
        "passed": true,
        "verdict": "Strong earnings ramp-up justifies current multiple as megawatt installations triple."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 180,
        "breakoutVolumeRatio": 2.8,
        "passed": true,
        "verdict": "Constructive base consolidation above 200-day SMA with rising weekly volume."
      }
    },
    "keyMoats": [
      "State-of-the-art 3.3 MW wind turbine platform licensed from AMSC Austria.",
      "Fully integrated manufacturing of blades, towers, nacelles, and hubs.",
      "Turnkey project execution and EPC capabilities in wind corridors."
    ],
    "catalysts": [
      "Execution of 3.2 GW order book ramping quarterly dispatch to record highs.",
      "Substantial OMS annuity revenue expansion from cumulative installed base.",
      "Adani, NTPC, and PSU renewable wind tender wins."
    ],
    "risks": [
      "Substation and power grid evacuation clearance delays.",
      "Seasonal wind installation drops during heavy monsoon months."
    ],
    "investmentThesis": "Inox Wind has cleaned up its debt, modernized to 3.3 MW turbines, and secured a 3+ GW backlog, positioning it as an explosive turnaround compounder in the clean energy cycle.",
    "entryPrice": 212.85,
    "target1Y": 430,
    "target3Y": 752.5,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 172
  },
  {
    "ticker": "POLYCAB.NS",
    "symbol": "POLYCAB",
    "name": "Polycab India Limited",
    "sector": "Power & Infrastructure Cables",
    "marketCapCategory": "Large-Cap (> ₹35,000 Cr)",
    "marketCapCr": 98000,
    "currentPrice": 6550,
    "multiBaggerScore": 92,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 24.8,
        "roce": 31.2,
        "passed": true,
        "verdict": "Unmatched 30%+ ROCE supported by massive backward integration and inventory turns."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 21.5,
        "profitGrowth3Y": 29.4,
        "passed": true,
        "verdict": "Outpacing industry growth by 2x via distribution expansion and institutional cables."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.04,
        "interestCoverage": 32,
        "passed": true,
        "verdict": "Cash-rich fortress balance sheet with over ₹2,000 Cr in net liquid investments."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 36.5,
        "fiiQoQChange": 1.4,
        "passed": true,
        "verdict": "STEADY_INFLOW"
      },
      "valuationRunway": {
        "peRatio": 46,
        "pegRatio": 1.35,
        "passed": true,
        "verdict": "Market leader commanding pricing power across wholesale and retail electrical channels."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 5900,
        "breakoutVolumeRatio": 2.3,
        "passed": true,
        "verdict": "Clear uptrend tracking rising 50-day SMA with high delivery percentages."
      }
    },
    "keyMoats": [
      "25%+ market share in organized Indian wires and cables.",
      "Vast nationwide distribution network covering 200,000+ retail touchpoints.",
      "Complete internal copper rod and PVC compounding integration."
    ],
    "catalysts": [
      "India infrastructure capex, data centers, and renewable power transmission expansion.",
      "International exports to US, UK, and Australia growing at 40%+ CAGR.",
      "Scale-up of Fast Moving Electrical Goods (FMEG) profitability."
    ],
    "risks": [
      "Copper and aluminum raw commodity price volatility.",
      "Intensifying competition from regional unorganized players."
    ],
    "investmentThesis": "Polycab is the undisputed wire and cable titan of India, leveraging 25%+ market share, superior ROCE, and negative debt to compound capital effortlessly.",
    "entryPrice": 6484.5,
    "target1Y": 13100,
    "target3Y": 22925,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 5240
  },
  {
    "ticker": "KEI.NS",
    "symbol": "KEI",
    "name": "KEI Industries Limited",
    "sector": "Power & Infrastructure Cables",
    "marketCapCategory": "Large-Cap (> ₹35,000 Cr)",
    "marketCapCr": 41800,
    "currentPrice": 4650,
    "multiBaggerScore": 90,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 21.5,
        "roce": 28.4,
        "passed": true,
        "verdict": "High return on capital employed supported by leadership in Extra High Voltage (EHV) cables."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 20.8,
        "profitGrowth3Y": 26.5,
        "passed": true,
        "verdict": "Order book exceeding ₹3,800 Cr driven by utilities, metro rail, and oil & gas."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.03,
        "interestCoverage": 26,
        "passed": true,
        "verdict": "Virtually zero long-term debt following disciplined working capital optimization."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 42,
        "fiiQoQChange": 1.8,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 48,
        "pegRatio": 1.4,
        "passed": true,
        "verdict": "Supported by specialized high-entry-barrier Extra High Voltage manufacturing."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 4100,
        "breakoutVolumeRatio": 2.1,
        "passed": true,
        "verdict": "Solid consolidation above 200-day moving average on steady accumulation."
      }
    },
    "keyMoats": [
      "Oligopolistic supplier of 400 kV Extra High Voltage (EHV) power cables.",
      "Technical collaboration with Brugg Cables Switzerland.",
      "Extensive retail dealer network expanding tier-2 and tier-3 presence."
    ],
    "catalysts": [
      "Commissioning of ₹1,000 Cr Greenfield Sanand manufacturing facility.",
      "Green energy transmission corridor capex by Power Grid Corporation.",
      "Underground cabling modernization in urban smart cities."
    ],
    "risks": [
      "Base metal volatility on fixed price institutional supply orders.",
      "Working capital expansion on large EPC contracts."
    ],
    "investmentThesis": "KEI is a premier pure-play compounder in extra-high-voltage cables and institutional power infrastructure, delivering 25%+ ROCE with virtually zero debt.",
    "entryPrice": 4603.5,
    "target1Y": 9300,
    "target3Y": 16275,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 3720
  },
  {
    "ticker": "APARINDS.NS",
    "symbol": "APARINDS",
    "name": "Apar Industries Limited",
    "sector": "Power & Infrastructure Cables",
    "marketCapCategory": "Large-Cap (> ₹35,000 Cr)",
    "marketCapCr": 36500,
    "currentPrice": 9150,
    "multiBaggerScore": 91,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 28.4,
        "roce": 34.2,
        "passed": true,
        "verdict": "Phenomenal 34%+ ROCE driven by premium specialty transformer oils and high-efficiency conductors."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 29.5,
        "profitGrowth3Y": 48,
        "passed": true,
        "verdict": "Export revenues exceeding 45% of total top-line across North America and Europe."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.18,
        "interestCoverage": 16.5,
        "passed": true,
        "verdict": "Low net debt with strong operating cash flows funding ongoing brownfield expansion."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 35.8,
        "fiiQoQChange": 2.2,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 38,
        "pegRatio": 1.05,
        "passed": true,
        "verdict": "Reasonable valuation given global market share leadership in specialty electrical oils."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 8200,
        "breakoutVolumeRatio": 2.5,
        "passed": true,
        "verdict": "Consolidating near all-time highs with dry selling pressure and rising 50 SMA."
      }
    },
    "keyMoats": [
      "World’s #3 manufacturer of transformer oils and specialty lubricants.",
      "Pioneer of high-efficiency ACCC conductors in India.",
      "Global supplier to major international utilities in 140+ countries."
    ],
    "catalysts": [
      "Global grid modernization and renewable energy transformer replacement cycle.",
      "US utilities shifting conductor sourcing away from Chinese vendors.",
      "Margin expansion on premium elastomeric and optical fiber hybrid cables."
    ],
    "risks": [
      "Base oil import duty changes and international freight rate spikes.",
      "Foreign exchange fluctuations on export receivables."
    ],
    "investmentThesis": "Apar Industries is a hidden global champion in transformer oils and advanced conductors, compounding profits at 48% with top-tier international market share.",
    "entryPrice": 9058.5,
    "target1Y": 18300,
    "target3Y": 32025,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 7320
  },
  {
    "ticker": "DIXON.NS",
    "symbol": "DIXON",
    "name": "Dixon Technologies (India) Limited",
    "sector": "High-Tech Electronics & EMS",
    "marketCapCategory": "Large-Cap (> ₹35,000 Cr)",
    "marketCapCr": 88000,
    "currentPrice": 14650,
    "multiBaggerScore": 93,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 26.5,
        "roce": 32.8,
        "passed": true,
        "verdict": "Massive asset turnover of 4.5x offsetting thin operating margins to generate 30%+ ROCE."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 44.5,
        "profitGrowth3Y": 52.8,
        "passed": true,
        "verdict": "Smartphone and IT hardware volumes exploding following PLI scheme approvals."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.15,
        "interestCoverage": 18,
        "passed": true,
        "verdict": "Conservative debt profile with high inventory turns generating positive free cash."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 41.2,
        "fiiQoQChange": 2.6,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 68,
        "pegRatio": 1.25,
        "passed": true,
        "verdict": "Valuation reflecting undeniable status as India’s national electronics manufacturing champion."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 12500,
        "breakoutVolumeRatio": 2.7,
        "passed": true,
        "verdict": "Leading industrial compounder printing continuous new highs supported by 20-week EMA."
      }
    },
    "keyMoats": [
      "Dominant scale producing 1 out of every 3 TVs and 1 out of 4 smartphones sold in India.",
      "Anchor partner for global giants like Motorola, Xiaomi, Samsung, and Lenovo.",
      "PLI approvals across Mobile, Telecom, IT Hardware, and Inverter appliances."
    ],
    "catalysts": [
      "Component localization (display modules, camera modules, mechanicals) expanding margin profile.",
      "Global export volumes to North America and Europe ramping rapidly.",
      "IT hardware manufacturing (laptops and tablets) entering high growth phase."
    ],
    "risks": [
      "Customer concentration risk among top smartphone brands.",
      "Thin margins leaving low cushion for raw component disruption."
    ],
    "investmentThesis": "Dixon Technologies is the Foxconn of India, dominating domestic electronics manufacturing with 50%+ profit growth and massive government PLI backing.",
    "entryPrice": 14503.5,
    "target1Y": 29300,
    "target3Y": 51275,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 11720
  },
  {
    "ticker": "AMBER.NS",
    "symbol": "AMBER",
    "name": "Amber Enterprises India Limited",
    "sector": "High-Tech Electronics & EMS",
    "marketCapCategory": "Mid-Cap (₹10,000–₹35,000 Cr)",
    "marketCapCr": 21500,
    "currentPrice": 6350,
    "multiBaggerScore": 90,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 18.8,
        "roce": 22.4,
        "passed": true,
        "verdict": "Healthy capital returns expanding as component manufacturing replaces simple box assembly."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 28,
        "profitGrowth3Y": 38.5,
        "passed": true,
        "verdict": "Surging railway HVAC, electronics PCBAs, and defense orders diversifying revenue."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.32,
        "interestCoverage": 9.8,
        "passed": true,
        "verdict": "Comfortable balance sheet with operating cash flow self-funding brownfield capex."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 38.4,
        "fiiQoQChange": 2.1,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 48,
        "pegRatio": 1.15,
        "passed": true,
        "verdict": "Reasonable entry point given backward integration into high-margin printed circuit boards."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 5400,
        "breakoutVolumeRatio": 2.6,
        "passed": true,
        "verdict": "Stage-2 base breakout following extended consolidation with institutional volume."
      }
    },
    "keyMoats": [
      "70%+ market share in outsourced room air conditioner manufacturing in India.",
      "Subsidiaries IL JIN and EVER delivering critical PCBAs for consumer durables and auto.",
      "Sidwal subsidiary holding a monopoly in Indian Railways air conditioning systems."
    ],
    "catalysts": [
      "Vande Bharat sleeper train HVAC contracts awarding to Sidwal.",
      "Korea Circuit JV for high-density interconnect (HDI) semiconductor substrates.",
      "Increasing domestic room air conditioner penetration from 8% to 25%."
    ],
    "risks": [
      "Seasonality linked to summer weather patterns for room AC sales.",
      "Commodity volatility in copper and aluminum."
    ],
    "investmentThesis": "Amber has transformed from an AC assembler into a high-tech electronics component and railway engineering powerhouse, compounding via deep backward integration.",
    "entryPrice": 6286.5,
    "target1Y": 12700,
    "target3Y": 22225,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 5080
  },
  {
    "ticker": "KPITTECH.NS",
    "symbol": "KPITTECH",
    "name": "KPIT Technologies Limited",
    "sector": "Automotive & Mobility Engineering",
    "marketCapCategory": "Mid-Cap (₹10,000–₹35,000 Cr)",
    "marketCapCr": 41200,
    "currentPrice": 1512.4,
    "multiBaggerScore": 91,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 28.8,
        "roce": 34.2,
        "passed": true,
        "verdict": "Elite capital productivity with 30%+ ROCE and negative working capital."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 34.5,
        "profitGrowth3Y": 46.2,
        "passed": true,
        "verdict": "Leading global pure-play in autonomous driving, electric powertrains, and connected mobility."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.08,
        "interestCoverage": 30,
        "passed": true,
        "verdict": "Practically debt-free balance sheet with over ₹1,200 Cr in liquid cash."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 44.5,
        "fiiQoQChange": 1.9,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 52,
        "pegRatio": 1.25,
        "passed": true,
        "verdict": "Valuation supported by multi-year Software-Defined Vehicle (SDV) contracts with global OEMs."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 1350,
        "breakoutVolumeRatio": 2.5,
        "passed": true,
        "verdict": "Bullish consolidation pattern above rising 200-day moving average."
      }
    },
    "keyMoats": [
      "Deep strategic software partnership with Honda, BMW, and Renault-Nissan.",
      "Over 6,000 specialized automotive software engineers.",
      "Proprietary software IP architectures for Battery Management and Autonomous Driving."
    ],
    "catalysts": [
      "Automotive industry mega-transition to Software-Defined Vehicles (SDVs).",
      "Scale-up of sodium-ion battery technology intellectual property commercialization.",
      "Long-term strategic technology alliance with Honda Motor."
    ],
    "risks": [
      "Global automotive OEM R&D capex delays.",
      "Concentration among top 5 automotive original equipment manufacturers."
    ],
    "investmentThesis": "KPIT Technologies is the global leader in automotive embedded software, profiting directly from the secular transition to electric and autonomous software-defined vehicles.",
    "entryPrice": 1497.28,
    "target1Y": 3024.8,
    "target3Y": 5293.4,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 1209.92
  },
  {
    "ticker": "TRENT.NS",
    "symbol": "TRENT",
    "name": "Trent Limited",
    "sector": "Retail & Consumer Compounders",
    "marketCapCategory": "Large-Cap (> ₹35,000 Cr)",
    "marketCapCr": 245000,
    "currentPrice": 6900,
    "multiBaggerScore": 95,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 31.4,
        "roce": 36.8,
        "passed": true,
        "verdict": "World-class retail capital efficiency driven by fast fashion inventory turns."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 52,
        "profitGrowth3Y": 82,
        "passed": true,
        "verdict": "Hyper-compounding top-line and profit growth powered by Zudio retail expansion."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.12,
        "interestCoverage": 19.5,
        "passed": true,
        "verdict": "Virtually debt-free with internal accruals self-funding 200+ new store additions per year."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 42.8,
        "fiiQoQChange": 2.5,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 95,
        "pegRatio": 1.2,
        "passed": true,
        "verdict": "High P/E multiple consistently justified by 50%+ same-store sales growth."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 6200,
        "breakoutVolumeRatio": 2.9,
        "passed": true,
        "verdict": "Market leader holding above 50-day moving average on institutional volume support."
      }
    },
    "keyMoats": [
      "Zudio fast-fashion value proposition with 100% private-label exclusive merchandise.",
      "Zara-style 14-day concept-to-shelf supply chain integration.",
      "Tata Group brand trust and premier mall / high-street real estate access."
    ],
    "catalysts": [
      "Zudio expanding to 800+ stores across tier-2, 3, and 4 Indian towns.",
      "Scale-up of Star Bazaar grocery joint venture turning EBITDA positive.",
      "New experimental retail formats in innerwear (Misbu) and beauty (Zudio Beauty)."
    ],
    "risks": [
      "Competition from Reliance Retail, Landmark, and unorganized fast-fashion entrants.",
      "High operating lease commitments across rapidly expanding retail footprint."
    ],
    "investmentThesis": "Trent is the undisputed retail wealth-creator of modern India, replicating the Inditex/Zara playbook through Zudio with 50%+ top-line and 80%+ profit compounding.",
    "entryPrice": 6831,
    "target1Y": 13800,
    "target3Y": 24150,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 5520
  },
  {
    "ticker": "VBL.NS",
    "symbol": "VBL",
    "name": "Varun Beverages Limited",
    "sector": "Retail & Consumer Compounders",
    "marketCapCategory": "Large-Cap (> ₹35,000 Cr)",
    "marketCapCr": 198000,
    "currentPrice": 1520,
    "multiBaggerScore": 92,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 32.5,
        "roce": 34,
        "passed": true,
        "verdict": "Premier FMCG capital returns supported by unmatched bottling route-to-market distribution."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 28.5,
        "profitGrowth3Y": 38.2,
        "passed": true,
        "verdict": "Consistent 30%+ compounding with domestic rural penetration and African market acquisitions."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.42,
        "interestCoverage": 15,
        "passed": true,
        "verdict": "Disciplined debt levels quickly repaid through immense free cash flow conversion."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 40.5,
        "fiiQoQChange": 1.8,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 58,
        "pegRatio": 1.45,
        "passed": true,
        "verdict": "FMCG blue-chip valuation supported by volume growth and rising per-capita beverage consumption."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 1380,
        "breakoutVolumeRatio": 2.2,
        "passed": true,
        "verdict": "Steady long-term compounder tracking rising 50 and 200-day exponential moving averages."
      }
    },
    "keyMoats": [
      "Accounts for over 90% of PepsiCo beverage sales volumes in India.",
      "Vast chilled distribution network with over 1.2 million visual coolers deployed.",
      "Exclusive franchise rights across Nepal, Sri Lanka, Morocco, Zambia, and South Africa."
    ],
    "catalysts": [
      "BevCo South Africa acquisition unlocking vast untapped African territory growth.",
      "Expansion of Sting energy drink and non-carbonated dairy/juice segments.",
      "Rural electrification accelerating penetration of retail refrigeration."
    ],
    "risks": [
      "Unseasonal summer rains dampening peak quarterly beverage consumption.",
      "Potential sugar tax increases or health-conscious consumer shifts."
    ],
    "investmentThesis": "Varun Beverages is a masterclass in route-to-market distribution, driving 30%+ secular compounding by bottling and distributing PepsiCo products across India and Africa.",
    "entryPrice": 1504.8,
    "target1Y": 3040,
    "target3Y": 5320,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 1216
  },
  {
    "ticker": "CRAFTSMAN.NS",
    "symbol": "CRAFTSMAN",
    "name": "Craftsman Automation Limited",
    "sector": "Automotive & Mobility Engineering",
    "marketCapCategory": "Mid-Cap (₹10,000–₹35,000 Cr)",
    "marketCapCr": 16800,
    "currentPrice": 7120,
    "multiBaggerScore": 88,
    "convictionTier": "HIGH_GROWTH",
    "pillarsPassedCount": 5,
    "pillars": {
      "capitalEfficiency": {
        "roe": 19.5,
        "roce": 22.8,
        "passed": true,
        "verdict": "High capital efficiency in precision machining and aluminum die-casting."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 34,
        "profitGrowth3Y": 38,
        "passed": true,
        "verdict": "Sunbeam acquisition integration unlocking major automotive lightweighting synergies."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.45,
        "interestCoverage": 8.5,
        "passed": true,
        "verdict": "Manageable leverage being paid down via strong industrial engineering cash flows."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 28.4,
        "fiiQoQChange": 2.3,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 38,
        "pegRatio": 1.1,
        "passed": true,
        "verdict": "Attractive entry valuation compared to other high-complexity precision auto peers."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 6200,
        "breakoutVolumeRatio": 2.4,
        "passed": true,
        "verdict": "Base breakout above 200 SMA on volume expansion."
      }
    },
    "keyMoats": [
      "Dominant supplier of cylinder blocks and heads for medium/heavy commercial vehicles.",
      "Proprietary automated storage and material handling division.",
      "Integrated high-pressure aluminum die-casting for EV components."
    ],
    "catalysts": [
      "Synergies and margin turnaround from Sunbeam Auto manufacturing assets.",
      "Electric vehicle battery casing and motor housing volume scale-up.",
      "Commercial vehicle replacement cycle demand in domestic freight logistics."
    ],
    "risks": [
      "Commercial vehicle cyclicality.",
      "Raw aluminum and electricity tariff inflation."
    ],
    "investmentThesis": "Craftsman Automation combines precision machining excellence with EV lightweighting and warehouse automation, poised for operating margin expansion and 3x returns.",
    "entryPrice": 7048.8,
    "target1Y": 14240,
    "target3Y": 24920,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 5696
  },
  {
    "ticker": "BSE.NS",
    "symbol": "BSE",
    "name": "BSE Limited",
    "sector": "Capital Markets & Wealth Infrastructure",
    "marketCapCategory": "Large-Cap (> ₹35,000 Cr)",
    "marketCapCr": 62000,
    "currentPrice": 4580,
    "multiBaggerScore": 94,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 36.4,
        "roce": 45.2,
        "passed": true,
        "verdict": "Exceptional financial platform returns with zero inventory, negative working capital, and massive margins."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 68,
        "profitGrowth3Y": 98,
        "passed": true,
        "verdict": "Derivatives market share surging from 0% to over 20%, generating exponential transaction revenues."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0,
        "interestCoverage": 100,
        "passed": true,
        "verdict": "Debt-free balance sheet with over ₹3,500 Cr in cash and treasury balances."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 38,
        "fiiQoQChange": 3.5,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 48,
        "pegRatio": 0.75,
        "passed": true,
        "verdict": "Sub-0.8 PEG reflecting incredible operating leverage inherent in exchange platforms."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 3800,
        "breakoutVolumeRatio": 3.6,
        "passed": true,
        "verdict": "Consolidating in a classic high-tight flag formation above rising 50-day moving average."
      }
    },
    "keyMoats": [
      "Asia’s oldest stock exchange operating as a regulated duopoly with NSE.",
      "BSE StAR MF platform commanding over 85% of India’s mutual fund transaction volume.",
      "SensX and Bankex weekly equity derivatives contract popularity explosion."
    ],
    "catalysts": [
      "Transaction fee hikes on equity derivatives contracts boosting net margins.",
      "StAR MF monetization and potential spin-off / value unlocking.",
      "Retail financialization of Indian household savings shifting into equity markets."
    ],
    "risks": [
      "Regulatory intervention by SEBI on retail derivatives trading volumes.",
      "Broad market corrections leading to turnover contraction."
    ],
    "investmentThesis": "BSE is an unassailable financial market toll-booth, compounding profits at 90%+ as Indian retail and institutional capital formalizes into capital market investments.",
    "entryPrice": 4534.2,
    "target1Y": 9160,
    "target3Y": 16030,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 3664
  },
  {
    "ticker": "CDSL.NS",
    "symbol": "CDSL",
    "name": "Central Depository Services (India) Limited",
    "sector": "Capital Markets & Wealth Infrastructure",
    "marketCapCategory": "Large-Cap (> ₹35,000 Cr)",
    "marketCapCr": 38000,
    "currentPrice": 1820,
    "multiBaggerScore": 92,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 32.8,
        "roce": 42,
        "passed": true,
        "verdict": "Annuity platform business model generating 60%+ operating EBITDA margins."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 34,
        "profitGrowth3Y": 42,
        "passed": true,
        "verdict": "Over 13 crore active demat accounts with 2-3 million new investors added every month."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0,
        "interestCoverage": 100,
        "passed": true,
        "verdict": "Zero debt balance sheet with ₹1,800+ Cr in liquid treasury reserves."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 34.5,
        "fiiQoQChange": 2.2,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 52,
        "pegRatio": 1.25,
        "passed": true,
        "verdict": "High quality premium multiple supported by monopolistic annuity issuer and transaction charges."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 1550,
        "breakoutVolumeRatio": 2.8,
        "passed": true,
        "verdict": "Post bonus issue consolidation breaking out to new structural highs."
      }
    },
    "keyMoats": [
      "77%+ market share in total active demat accounts in India.",
      "Preferred depository for tech-savvy discount brokers (Zerodha, Groww, Angel One).",
      "Sticky annual issuer charges paid by thousands of listed and unlisted Indian companies."
    ],
    "catalysts": [
      "India demat penetration rising from 10% to global benchmark of 25%+.",
      "Insurance dematerialization mandate opening immense recurring account volume.",
      "Transaction volume growth from record IPOs and unlisted company share holdings."
    ],
    "risks": [
      "Regulatory limits on transaction tariffs.",
      "Market downturns moderating monthly demat account addition velocity."
    ],
    "investmentThesis": "CDSL operates a licensed duopoly toll-booth on Indian wealth creation, generating 60%+ margins and zero debt as tens of millions of new investors open demat accounts.",
    "entryPrice": 1801.8,
    "target1Y": 3640,
    "target3Y": 6370,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 1456
  },
  {
    "ticker": "ANGELONE.NS",
    "symbol": "ANGELONE",
    "name": "Angel One Limited",
    "sector": "Capital Markets & Wealth Infrastructure",
    "marketCapCategory": "Mid-Cap (₹10,000–₹35,000 Cr)",
    "marketCapCr": 26500,
    "currentPrice": 2950,
    "multiBaggerScore": 90,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 38.5,
        "roce": 44,
        "passed": true,
        "verdict": "Asset-light digital model delivering immense return on equity."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 42,
        "profitGrowth3Y": 48,
        "passed": true,
        "verdict": "Client base exceeding 2.5 crore, compounding at 50%+ annual growth rate."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.35,
        "interestCoverage": 16,
        "passed": true,
        "verdict": "Conservative balance sheet with client margin funding self-liquidating in nature."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 30.5,
        "fiiQoQChange": 2.4,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 20,
        "pegRatio": 0.55,
        "passed": true,
        "verdict": "Extremely attractive sub-20 P/E with a 0.55 PEG ratio representing exceptional value."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 2550,
        "breakoutVolumeRatio": 3,
        "passed": true,
        "verdict": "Clear reversal from consolidation base on surging trading volume."
      }
    },
    "keyMoats": [
      "Fintech app interface ranking among top financial platforms in India.",
      "AI-driven algorithmic client onboarding and margin trading facility (MTF).",
      "Low customer acquisition cost driven by viral social media and referral engines."
    ],
    "catalysts": [
      "Scale-up of high-margin Margin Trading Facility (MTF) loan book to ₹5,000+ Cr.",
      "Distribution expansion into mutual funds, insurance, and personal loans via Super App.",
      "Young demographic profile of new retail investors entering the stock market."
    ],
    "risks": [
      "SEBI tightening retail index derivatives guidelines.",
      "Systemic market drops impacting active retail trader turnover."
    ],
    "investmentThesis": "Angel One is a high-growth fintech engine trading at a deep discount (sub-20 P/E) despite 40%+ ROE and explosive client acquisition across tier-2 and tier-3 India.",
    "entryPrice": 2920.5,
    "target1Y": 5900,
    "target3Y": 10325,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 2360
  },
  {
    "ticker": "MCX.NS",
    "symbol": "MCX",
    "name": "Multi Commodity Exchange of India Limited",
    "sector": "Capital Markets & Wealth Infrastructure",
    "marketCapCategory": "Mid-Cap (₹10,000–₹35,000 Cr)",
    "marketCapCr": 32000,
    "currentPrice": 6280,
    "multiBaggerScore": 92,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 28.5,
        "roce": 36,
        "passed": true,
        "verdict": "Operating profit margins surging past 55% following migration to in-house trading software."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 38,
        "profitGrowth3Y": 65,
        "passed": true,
        "verdict": "Commodity options average daily turnover (ADTO) compounding at 120%+ YoY."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0,
        "interestCoverage": 100,
        "passed": true,
        "verdict": "Completely debt-free exchange with over ₹1,500 Cr in liquid investments."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 48,
        "fiiQoQChange": 2.8,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 46,
        "pegRatio": 0.9,
        "passed": true,
        "verdict": "Operating leverage unleashing immense earnings growth after ending legacy vendor royalties."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 5300,
        "breakoutVolumeRatio": 3.1,
        "passed": true,
        "verdict": "Strong institutional breakout printing all-time highs on rising commodity volatility."
      }
    },
    "keyMoats": [
      "96%+ market share in Indian commodity derivatives trading.",
      "Natural monopoly in gold, silver, crude oil, and natural gas contracts.",
      "Completion of migration to TCS commodity trading software eliminating 60+ Cr quarterly vendor fees."
    ],
    "catalysts": [
      "Institutional participation (Mutual Funds, FPIs) entering Indian commodity derivatives.",
      "Launch of new monthly and weekly index options contracts.",
      "High global commodity price volatility driving hedging demand."
    ],
    "risks": [
      "Regulatory changes in margin requirements for commodity options.",
      "Prolonged periods of low volatility in energy and bullion."
    ],
    "investmentThesis": "MCX holds an absolute 96% monopoly on Indian commodity derivatives, generating explosive 60%+ margins and debt-free cash flows as commodity options volumes soar.",
    "entryPrice": 6217.2,
    "target1Y": 12560,
    "target3Y": 21980,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 5024
  },
  {
    "ticker": "TITAGARH.NS",
    "symbol": "TITAGARH",
    "name": "Titagarh Rail Systems Limited",
    "sector": "Power & Infrastructure Cables",
    "marketCapCategory": "Mid-Cap (₹10,000–₹35,000 Cr)",
    "marketCapCr": 17200,
    "currentPrice": 1280,
    "multiBaggerScore": 91,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 22,
        "roce": 27.5,
        "passed": true,
        "verdict": "Exceptional capital productivity on wagon and passenger train manufacturing."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 48,
        "profitGrowth3Y": 72,
        "passed": true,
        "verdict": "Order backlog exceeding ₹28,000 Cr spanning freight wagons, metro coaches, and Vande Bharat."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.12,
        "interestCoverage": 18,
        "passed": true,
        "verdict": "Prudent balance sheet with net cash position supported by strong operating cash flows."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 31,
        "fiiQoQChange": 3,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 42,
        "pegRatio": 0.85,
        "passed": true,
        "verdict": "Sub-1.0 PEG ratio reflecting high-growth multi-year railway modernizing tailwind."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 1100,
        "breakoutVolumeRatio": 2.8,
        "passed": true,
        "verdict": "Constructive consolidation above 200 SMA on institutional accumulation."
      }
    },
    "keyMoats": [
      "India’s premier manufacturer of freight wagons and modern stainless-steel passenger trainsets.",
      "Consortium partner with BHEL for 80 Vande Bharat sleeper trainsets.",
      "Exclusive supplier of aluminum body metro train coaches for Surat, Ahmedabad, and Bengaluru."
    ],
    "catalysts": [
      "Dedicated Freight Corridor (DFC) wagon replenishment mega-orders.",
      "High-margin passenger coach and metro trainset execution ramping in 2025-2027.",
      "Wheelset manufacturing joint venture with Ramkrishna Forgings."
    ],
    "risks": [
      "Steel raw material inflation on long-duration government supply contracts.",
      "Production testing and certification milestone delays."
    ],
    "investmentThesis": "Titagarh is the undisputed leader in India’s railway modernization, holding a ₹28,000 Cr order backlog spanning high-margin Vande Bharat and metro train coaches.",
    "entryPrice": 1267.2,
    "target1Y": 2560,
    "target3Y": 4480,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 1024
  },
  {
    "ticker": "JWL.NS",
    "symbol": "JWL",
    "name": "Jupiter Wagons Limited",
    "sector": "Power & Infrastructure Cables",
    "marketCapCategory": "Small-Cap (₹1,500–₹10,000 Cr)",
    "marketCapCr": 21800,
    "currentPrice": 515,
    "multiBaggerScore": 89,
    "convictionTier": "HIGH_GROWTH",
    "pillarsPassedCount": 5,
    "pillars": {
      "capitalEfficiency": {
        "roe": 24.5,
        "roce": 29,
        "passed": true,
        "verdict": "High return on capital employed supported by backward integration into castings and brake discs."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 55,
        "profitGrowth3Y": 78,
        "passed": true,
        "verdict": "Order book exceeding ₹7,000 Cr providing solid 2+ years of manufacturing visibility."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.08,
        "interestCoverage": 22,
        "passed": true,
        "verdict": "Almost net debt-free following successful QIP and strong cash generation."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 26.5,
        "fiiQoQChange": 2.5,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 38,
        "pegRatio": 0.9,
        "passed": true,
        "verdict": "Sensible valuation given superior EBITDA margins of 13-14% compared to peers."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 450,
        "breakoutVolumeRatio": 2.6,
        "passed": true,
        "verdict": "Steady consolidation near all-time highs with dry volume on pullbacks."
      }
    },
    "keyMoats": [
      "Fully integrated wagon manufacturer with in-house foundry and braking systems.",
      "Proprietary DAKO braking technology joint venture.",
      "Commercial electric vehicle division (Jupiter Electric Mobility)."
    ],
    "catalysts": [
      "Indian Railways ongoing procurement of 100,000+ new freight wagons.",
      "Braking system and axle manufacturing localization.",
      "Expansion into specialized military and containerized auto freight wagons."
    ],
    "risks": [
      "Heavy dependence on Indian Railways tender frequency.",
      "Scrap steel and foundry coke price fluctuations."
    ],
    "investmentThesis": "Jupiter Wagons combines integrated rail wagon manufacturing with proprietary braking systems, generating 29% ROCE and accelerating profits in the railway capex super-cycle.",
    "entryPrice": 509.85,
    "target1Y": 1030,
    "target3Y": 1802.5,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 412
  },
  {
    "ticker": "MANKIND.NS",
    "symbol": "MANKIND",
    "name": "Mankind Pharma Limited",
    "sector": "Healthcare & Pharma",
    "marketCapCategory": "Large-Cap (> ₹35,000 Cr)",
    "marketCapCr": 105000,
    "currentPrice": 2620,
    "multiBaggerScore": 91,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 24,
        "roce": 28.5,
        "passed": true,
        "verdict": "High capital productivity driven by high-margin chronic therapy expansion."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 18.5,
        "profitGrowth3Y": 26,
        "passed": true,
        "verdict": "Outpacing Indian pharma market growth via massive doctor reach and Bharat Bharat positioning."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.22,
        "interestCoverage": 18,
        "passed": true,
        "verdict": "Strong cash flows comfortably absorbing the strategic Bharat Serums & Vaccines acquisition."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 35,
        "fiiQoQChange": 2,
        "passed": true,
        "verdict": "STEADY_INFLOW"
      },
      "valuationRunway": {
        "peRatio": 45,
        "pegRatio": 1.4,
        "passed": true,
        "verdict": "Premium multiple justified by domestic focus with zero US FDA generic price erosion risk."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 2300,
        "breakoutVolumeRatio": 2.4,
        "passed": true,
        "verdict": "Steady structural compounder holding rising 50-day moving average."
      }
    },
    "keyMoats": [
      "#1 in domestic prescription volume in India with over 16,000 field representatives.",
      "Dominant consumer healthcare brands (Manforce, Prega News, Gas-O-Fast).",
      "Transformative Bharat Serums acquisition providing monopoly biologicals and women’s health portfolio."
    ],
    "catalysts": [
      "Integration synergies and international rollout of Bharat Serums biologicals.",
      "Rapid expansion in chronic segments (cardiac, anti-diabetes, respiratory).",
      "Hospital division growth and specialty oncology formulations."
    ],
    "risks": [
      "National List of Essential Medicines (NLEM) price control expansions.",
      "Integration execution on large debt-funded biological acquisitions."
    ],
    "investmentThesis": "Mankind Pharma is the king of domestic formulations in India, immune to US generic price erosion and compounding at 25%+ with dominant OTC brands and high chronic doctor prescriptions.",
    "entryPrice": 2593.8,
    "target1Y": 5240,
    "target3Y": 9170,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 2096
  },
  {
    "ticker": "MAXHEALTH.NS",
    "symbol": "MAXHEALTH",
    "name": "Max Healthcare Institute Limited",
    "sector": "Healthcare & Pharma",
    "marketCapCategory": "Large-Cap (> ₹35,000 Cr)",
    "marketCapCr": 98000,
    "currentPrice": 1010,
    "multiBaggerScore": 92,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 21,
        "roce": 26.5,
        "passed": true,
        "verdict": "Industry-leading ARPOB (Average Revenue Per Occupied Bed) of ₹75,000+ generating high operating ROCE."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 22,
        "profitGrowth3Y": 34,
        "passed": true,
        "verdict": "Operating profit compounding at 34% through brownfield bed expansions and high-margin oncology/transplants."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.05,
        "interestCoverage": 28,
        "passed": true,
        "verdict": "Practically debt-free with over ₹1,500 Cr cash reserves self-funding 2,500 new bed additions."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 48.5,
        "fiiQoQChange": 1.8,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 55,
        "pegRatio": 1.35,
        "passed": true,
        "verdict": "Valuation reflecting dominant hospital positioning in affluent NCR and Mumbai micro-markets."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 890,
        "breakoutVolumeRatio": 2.2,
        "passed": true,
        "verdict": "Resuming long-term compounding uptrend above rising 50-day SMA."
      }
    },
    "keyMoats": [
      "Highest ARPOB in India driven by quaternary surgical specialties.",
      "Dominant hospital network in high-paying Delhi-NCR, Mumbai, and Punjab.",
      "Max Lab pathology network extending asset-light diagnostic revenues."
    ],
    "catalysts": [
      "Doubling bed capacity from 4,000 to 8,000 beds over the next 4 years.",
      "Medical tourism surge from Middle East, CIS, and Africa.",
      "Robotic surgery and advanced genomics center commercialization."
    ],
    "risks": [
      "Shortage and wage inflation for specialized super-specialty surgeons.",
      "Regulatory caps on private healthcare pricing."
    ],
    "investmentThesis": "Max Healthcare operates the most lucrative hospital network in India with industry-best bed profitability, debt-free finances, and a funded plan to double bed capacity.",
    "entryPrice": 999.9,
    "target1Y": 2020,
    "target3Y": 3535,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 808
  },
  {
    "ticker": "MEDANTA.NS",
    "symbol": "MEDANTA",
    "name": "Global Health Limited (Medanta)",
    "sector": "Healthcare & Pharma",
    "marketCapCategory": "Mid-Cap (₹10,000–₹35,000 Cr)",
    "marketCapCr": 34500,
    "currentPrice": 1280,
    "multiBaggerScore": 90,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 22.5,
        "roce": 27,
        "passed": true,
        "verdict": "Clinical excellence and doctor equity alignment delivering high hospital ROCE."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 24.5,
        "profitGrowth3Y": 42,
        "passed": true,
        "verdict": "Rapid ramp-up of Patna and Lucknow hospitals driving operating leverage."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.08,
        "interestCoverage": 24,
        "passed": true,
        "verdict": "Net cash balance sheet with strong operational cash flow generation."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 38,
        "fiiQoQChange": 2.2,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 46,
        "pegRatio": 1.15,
        "passed": true,
        "verdict": "Attractive entry multiple given maturing Lucknow and Patna bed monetization."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 1120,
        "breakoutVolumeRatio": 2.5,
        "passed": true,
        "verdict": "Constructive consolidation above 200 SMA on institutional volume."
      }
    },
    "keyMoats": [
      "Dr. Naresh Trehan’s legendary clinical reputation attracting premier cardiology and oncology cases.",
      "Flagship 1,400-bed Gurugram med-city hospital.",
      "High doctor retention through equity ownership and research grants."
    ],
    "catalysts": [
      "Maturing EBITDA margins in new Lucknow, Patna, and upcoming Noida hospitals.",
      "Expansion of outpatient digital clinics across northern India.",
      "Surge in complex international surgical referrals."
    ],
    "risks": [
      "High revenue concentration in flagship Gurugram facility.",
      "Talent poaching from competing private hospital chains."
    ],
    "investmentThesis": "Medanta is compounding profits at 40%+ as its massive hospital expansions in Lucknow and Patna reach peak bed occupancy, delivering exceptional quaternary clinical care.",
    "entryPrice": 1267.2,
    "target1Y": 2560,
    "target3Y": 4480,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 1024
  },
  {
    "ticker": "NEULANDLAB.NS",
    "symbol": "NEULANDLAB",
    "name": "Neuland Laboratories Limited",
    "sector": "Healthcare & Pharma",
    "marketCapCategory": "Small-Cap (₹1,500–₹10,000 Cr)",
    "marketCapCr": 18500,
    "currentPrice": 14450,
    "multiBaggerScore": 91,
    "convictionTier": "ULTRA_CONVICTION",
    "pillarsPassedCount": 6,
    "pillars": {
      "capitalEfficiency": {
        "roe": 28.5,
        "roce": 34,
        "passed": true,
        "verdict": "Elite chemical synthesis margins in Custom Manufacturing Solutions (CMS)."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 26,
        "profitGrowth3Y": 62,
        "passed": true,
        "verdict": "High-margin commercial peptide and specialty API manufacturing compounding rapidly."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.15,
        "interestCoverage": 18,
        "passed": true,
        "verdict": "Prudent balance sheet with net cash generation from commercial CMS molecules."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 28,
        "fiiQoQChange": 3.2,
        "passed": true,
        "verdict": "HEAVY_ACCUMULATION"
      },
      "valuationRunway": {
        "peRatio": 44,
        "pegRatio": 0.85,
        "passed": true,
        "verdict": "Sub-1.0 PEG reflecting explosive operating leverage in commercial peptide synthesis."
      },
      "technicalStage": {
        "stage": "Stage-2 Continuation",
        "support200D": 12200,
        "breakoutVolumeRatio": 2.8,
        "passed": true,
        "verdict": "High-momentum pharma compounder making new highs on institutional accumulation."
      }
    },
    "keyMoats": [
      "World-class expertise in complex peptide chemistry synthesis.",
      "Preferred CDMO partner for global innovator pharmaceutical giants.",
      "US FDA-inspected manufacturing complexes in Hyderabad."
    ],
    "catalysts": [
      "Commercialization of blockbuster Phase-3 peptide molecules.",
      "Capacity expansion of Unit-3 specialty synthesis suites.",
      "Global biotech shift toward reliable Indian CDMO partners."
    ],
    "risks": [
      "Customer molecule attrition during clinical trials.",
      "Regulatory inspection audits by international agencies."
    ],
    "investmentThesis": "Neuland Laboratories is a high-tech CDMO powerhouse with complex peptide capabilities, delivering 34% ROCE and 60%+ profit compounding as innovator molecules commercialize.",
    "entryPrice": 14305.5,
    "target1Y": 28900,
    "target3Y": 50575,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 11560
  },
  {
    "ticker": "TARSONS.NS",
    "symbol": "TARSONS",
    "name": "Tarsons Products Limited",
    "sector": "Healthcare & Pharma",
    "marketCapCategory": "Small-Cap (₹1,500–₹10,000 Cr)",
    "marketCapCr": 2850,
    "currentPrice": 535,
    "multiBaggerScore": 86,
    "convictionTier": "EMERGING_COMPOUNDER",
    "pillarsPassedCount": 5,
    "pillars": {
      "capitalEfficiency": {
        "roe": 18.4,
        "roce": 22,
        "passed": true,
        "verdict": "Historically superior 45%+ EBITDA margins in plastic labware consumables."
      },
      "growthAcceleration": {
        "salesGrowth3Y": 16.5,
        "profitGrowth3Y": 22,
        "passed": true,
        "verdict": "Panchla new facility commissioning tripling manufacturing capacity."
      },
      "balanceSheetSolvency": {
        "debtToEquity": 0.25,
        "interestCoverage": 11,
        "passed": true,
        "verdict": "Manageable leverage funding global European distribution acquisition."
      },
      "institutionalFootprint": {
        "fiiDiiHolding": 21,
        "fiiQoQChange": 1.5,
        "passed": true,
        "verdict": "STEADY_INFLOW"
      },
      "valuationRunway": {
        "peRatio": 32,
        "pegRatio": 1.25,
        "passed": true,
        "verdict": "Reasonable valuation given operating leverage about to kick in from new capacity."
      },
      "technicalStage": {
        "stage": "Multi-Month Base Breakout",
        "support200D": 470,
        "breakoutVolumeRatio": 2.5,
        "passed": true,
        "verdict": "Reversing from multi-month accumulation bottom on volume expansion."
      }
    },
    "keyMoats": [
      "Domestic monopoly in virgin polypropylene labware and pipette tips.",
      "High switching costs for certified diagnostic and pharmaceutical laboratory tests.",
      "Inoue acquisition providing direct European diagnostic distribution channels."
    ],
    "catalysts": [
      "Commercial production ramp-up at massive new Panchla facility.",
      "Import substitution as Indian labs replace expensive Thermo Fisher imports with Tarsons.",
      "Surge in domestic biotechnology and contract research laboratory testing."
    ],
    "risks": [
      "Medical grade resin price inflation.",
      "Longer gestation for European hospital laboratory validation trials."
    ],
    "investmentThesis": "Tarsons is a niche consumable compounder trading at a sensible multiple, selling high-margin disposable labware with capacity tripling to drive explosive operating leverage.",
    "entryPrice": 529.65,
    "target1Y": 1070,
    "target3Y": 1872.5,
    "expectedMultiplier": "3.5x Multiplier",
    "stopLossLongTerm": 428
  }
];

function getBaseMultiBaggerPicks(): MultiBaggerCandidate[] {
  try {
    if (fs.existsSync(MULTIBAGGER_CACHE_PATH)) {
      const raw = fs.readFileSync(MULTIBAGGER_CACHE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (err) {
    console.error('[MultiBagger Engine] Error reading cache file:', err);
  }
  return CURATED_MULTIBAGGER_PICKS;
}

export async function getMultiBaggerCandidates(filters?: {
  sector?: string;
  conviction?: string;
  marketCap?: string;
  minScore?: number;
}): Promise<MultiBaggerResponse> {
  let list = (await refreshStockRows(getBaseMultiBaggerPicks())).map(pick => ({
    ...pick,
    entryPrice: +(pick.currentPrice * 0.99).toFixed(2),
    target1Y: +(pick.currentPrice * 2).toFixed(2),
    target3Y: +(pick.currentPrice * 3.5).toFixed(2),
    stopLossLongTerm: +(pick.currentPrice * 0.8).toFixed(2),
  }));

  if (filters?.sector && filters.sector !== 'All') {
    list = list.filter((c) => c.sector.toLowerCase().includes(filters.sector!.toLowerCase()));
  }

  if (filters?.conviction && filters.conviction !== 'All') {
    list = list.filter((c) => c.convictionTier === filters.conviction);
  }

  if (filters?.marketCap && filters.marketCap !== 'All') {
    list = list.filter((c) => c.marketCapCategory === filters.marketCap);
  }

  if (typeof filters?.minScore === 'number' && filters.minScore > 0) {
    list = list.filter((c) => c.multiBaggerScore >= filters.minScore!);
  }

  // Sort by multi-bagger score descending
  list.sort((a, b) => b.multiBaggerScore - a.multiBaggerScore);

  const avgScore = list.length > 0 
    ? Math.round(list.reduce((acc, c) => acc + c.multiBaggerScore, 0) / list.length) 
    : 0;

  return {
    success: true,
    count: list.length,
    generatedAt: new Date().toISOString(),
    marketContext: {
      macroCycle: 'India Secular Capex & Tech Sovereignty Expansion',
      smallCapIndexBreadth: 'Stage-2 Accumulation above 200-day Moving Average',
      averageScore: avgScore,
    },
    data: list,
  };
}

export function saveMultiBaggerCache(): void {
  try {
    const dir = path.dirname(MULTIBAGGER_CACHE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(MULTIBAGGER_CACHE_PATH, JSON.stringify(CURATED_MULTIBAGGER_PICKS, null, 2), 'utf-8');
  } catch (err) {
    console.error('[MultiBagger Engine] Failed to save cache:', err);
  }
}
