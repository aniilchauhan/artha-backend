const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// 1. Retrieve MongoDB URI from environment or .env.local
const envPath = path.join(__dirname, '../.env.local');
let mongodbUri = process.env.MONGODB_URI;

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const lines = envContent.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const parts = trimmed.split('=');
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      if (key === 'MONGODB_URI') {
        mongodbUri = val.replace(/^["']|["']$/g, '');
      }
    }
  }
}

if (!mongodbUri) {
  console.error('ERROR: MONGODB_URI is not defined in environment variables or .env.local');
  process.exit(1);
}

// Define Schema references dynamically
const StockSchema = new mongoose.Schema({
  ticker: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  change: { type: Number, default: 0 },
  changePercent: { type: Number, default: 0 },
  high: { type: Number, default: 0 },
  low: { type: Number, default: 0 },
  volume: { type: Number, default: 0 },
  marketCap: { type: Number, default: 0 },
  sector: { type: String, default: 'Other' }
}, { strict: false });
const Stock = mongoose.models.Stock || mongoose.model('Stock', StockSchema);

const collections = {
  MasterCompanyProfile: mongoose.models.MasterCompanyProfile || mongoose.model('MasterCompanyProfile', new mongoose.Schema({}, { strict: false }), 'companyprofiles'),
  BusinessSegment: mongoose.models.BusinessSegment || mongoose.model('BusinessSegment', new mongoose.Schema({}, { strict: false }), 'businesssegments'),
  ProductIntelligence: mongoose.models.ProductIntelligence || mongoose.model('ProductIntelligence', new mongoose.Schema({}, { strict: false }), 'products'),
  CustomerIntelligence: mongoose.models.CustomerIntelligence || mongoose.model('CustomerIntelligence', new mongoose.Schema({}, { strict: false }), 'customers'),
  SupplierIntelligence: mongoose.models.SupplierIntelligence || mongoose.model('SupplierIntelligence', new mongoose.Schema({}, { strict: false }), 'suppliers'),
  ManufacturingOperations: mongoose.models.ManufacturingOperations || mongoose.model('ManufacturingOperations', new mongoose.Schema({}, { strict: false }), 'operations'),
  FinancialStatement: mongoose.models.FinancialStatement || mongoose.model('FinancialStatement', new mongoose.Schema({}, { strict: false }), 'financialstatements'),
  FinancialRatio: mongoose.models.FinancialRatio || mongoose.model('FinancialRatio', new mongoose.Schema({}, { strict: false }), 'ratios'),
  ShareholdingOwnership: mongoose.models.ShareholdingOwnership || mongoose.model('ShareholdingOwnership', new mongoose.Schema({}, { strict: false }), 'shareholdings'),
  ManagementGovernance: mongoose.models.ManagementGovernance || mongoose.model('ManagementGovernance', new mongoose.Schema({}, { strict: false }), 'governance'),
  CompetitorIntelligence: mongoose.models.CompetitorIntelligence || mongoose.model('CompetitorIntelligence', new mongoose.Schema({}, { strict: false }), 'competitorintelligence'),
  IndustryMarketAnalysis: mongoose.models.IndustryMarketAnalysis || mongoose.model('IndustryMarketAnalysis', new mongoose.Schema({}, { strict: false }), 'industryanalyses'),
  MacroeconomicIndicator: mongoose.models.MacroeconomicIndicator || mongoose.model('MacroeconomicIndicator', new mongoose.Schema({}, { strict: false }), 'macroindicators'),
  NewsEventsEarnings: mongoose.models.NewsEventsEarnings || mongoose.model('NewsEventsEarnings', new mongoose.Schema({}, { strict: false }), 'newseventscalls'),
  LegalCompliance: mongoose.models.LegalCompliance || mongoose.model('LegalCompliance', new mongoose.Schema({}, { strict: false }), 'legalcases'),
  CorporateAction: mongoose.models.CorporateAction || mongoose.model('CorporateAction', new mongoose.Schema({}, { strict: false }), 'corporateactions'),
  PriceTechnicalData: mongoose.models.PriceTechnicalData || mongoose.model('PriceTechnicalData', new mongoose.Schema({}, { strict: false }), 'pricetechnicaldata'),
  AnalystValuationModel: mongoose.models.AnalystValuationModel || mongoose.model('AnalystValuationModel', new mongoose.Schema({}, { strict: false }), 'valuationmodels'),
  ESGSustainability: mongoose.models.ESGSustainability || mongoose.model('ESGSustainability', new mongoose.Schema({}, { strict: false }), 'esgsustainability'),
  AIKnowledgeBase: mongoose.models.AIKnowledgeBase || mongoose.model('AIKnowledgeBase', new mongoose.Schema({}, { strict: false }), 'aiknowledgebases')
};

const firstNames = ['Rajesh', 'Sanjay', 'Amit', 'Vikram', 'Anil', 'Sunil', 'Vijay', 'Rahul', 'Deepak', 'Arvind'];
const lastNames = ['Sharma', 'Mehta', 'Patel', 'Joshi', 'Gupta', 'Chauhan', 'Singhal', 'Reddy'];
const getRandomName = () => `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${lastNames[Math.floor(Math.random() * lastNames.length)]}`;
const randBetween = (min, max) => Math.random() * (max - min) + min;
const randIntBetween = (min, max) => Math.floor(randBetween(min, max));
const selectRandom = (arr, num) => arr.sort(() => 0.5 - Math.random()).slice(0, num);

async function seedConsolidatedData() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongodbUri);
    console.log('Connected.');

    const stocks = await Stock.find({});
    console.log(`Found ${stocks.length} stocks to process.`);

    if (stocks.length === 0) {
      console.error('Run seed-nse-stocks.js first.');
      process.exit(1);
    }

    const bulkOps = {};
    Object.keys(collections).forEach(key => {
      bulkOps[key] = [];
    });

    for (let sIdx = 0; sIdx < stocks.length; sIdx++) {
      const stock = stocks[sIdx];
      const ticker = stock.ticker;
      const name = stock.name;
      const price = stock.price;
      const mCap = stock.marketCap || 5000;
      const sector = stock.sector || 'Other';

      if (sIdx % 100 === 0) {
        console.log(`Generating mock domains for ${sIdx}/${stocks.length}: ${ticker}...`);
      }

      // 1. Master Company Profile & 34. Promoter Intelligence
      bulkOps.MasterCompanyProfile.push({
        ticker,
        companyName: name,
        stockSymbol: ticker,
        isin: `INE${randIntBetween(100, 999)}A010${randIntBetween(10, 99)}`,
        sector,
        industry: `${sector} Industry`,
        subIndustry: `${sector} Sub-Segment`,
        marketCap: mCap,
        listingExchange: 'NSE',
        foundedYear: randIntBetween(1970, 2015),
        headquarters: selectRandom(['Mumbai, India', 'Bengaluru, India', 'New Delhi, India', 'Chennai, India'], 1)[0],
        website: `https://www.${ticker.toLowerCase()}.com`,
        annualReport: `https://www.${ticker.toLowerCase()}.com/investors`,
        investorRelations: `https://www.${ticker.toLowerCase()}.com/investors`,
        businessDescription: `${name} is a leading provider in the ${sector} industry.`,
        businessModel: `Generates revenues via value-added products and service streams in ${sector}.`,
        visionMission: `Vision: To shape a sustainable future in ${sector}. Mission: High standard client support.`,
        promoterTree: {
          familyTree: 'Founding family trusts holds control.',
          otherListedCompanies: [name],
          unlistedCompanies: [`${ticker} Holdings Pvt Ltd`],
          politicalConnections: 'None',
          criminalCases: 'None',
          incomeTaxCases: 'None',
          promoterReputation: 'Good',
          promoterWealth: mCap * 0.45
        }
      });

      // 2. Business & Revenue Segments & 25. Business Segment Analysis
      bulkOps.BusinessSegment.push({
        ticker,
        visionMission: 'Vision: Empower commerce. Mission: Ethical scaling.',
        businessModel: 'B2B and client manufacturing contract deliveries.',
        businessDescription: `${name} operates a highly integrated enterprise network across India.`,
        coreStrategy: 'Cost leadership, segment scaling, and digital transformation.',
        segmentsList: [
          {
            segmentName: 'Core Product Sales',
            segmentDescription: 'Manufacturing and sales of systems.',
            revenueContribution: 70,
            profitContribution: 75,
            ebitdaMargin: 24.5,
            yoyGrowthRate: 12.5,
            targetMarket: 'Industrial clients',
            competitivePosition: 'Leader',
            futureExpansionPlans: 'Expand to overseas channels.',
            segmentRisks: 'Raw material inflation',
            capitalAllocation: 60
          },
          {
            segmentName: 'Services & Support',
            segmentDescription: 'Integration and maintenance SLAs.',
            revenueContribution: 30,
            profitContribution: 25,
            ebitdaMargin: 18.0,
            yoyGrowthRate: 14.8,
            targetMarket: 'Existing clients',
            competitivePosition: 'Sole provider',
            futureExpansionPlans: 'Introduce cloud diagnostics.',
            segmentRisks: 'Attrition of engineers',
            capitalAllocation: 40
          }
        ]
      });

      // 3. Products & Services & 26. Product Intelligence
      bulkOps.ProductIntelligence.push({
        ticker,
        mainProducts: [`${sector} Core Series`, `${ticker} Lite Package`],
        services: ['Integration Support', 'Maintenance Contracts'],
        flagshipProducts: [`${sector} Core Series`],
        newProducts: [`${ticker} Cloud Suite v2`],
        productPipeline: [`NextGen ${ticker} AI Assistant`],
        brandsOwned: [`${ticker} Premium`, `${ticker} Connect`],
        productsList: [
          {
            productName: `${sector} Core Series`,
            category: 'Core System',
            launchDate: '2022-04-12',
            productLifecycle: 'Growth',
            revenueContribution: mCap * 0.08,
            grossMargin: 65,
            manufacturingCost: price * 0.35,
            sellingPrice: price,
            competitors: ['Competitor Alpha Core'],
            usp: 'Reliable telemetry logging.',
            patentProtected: 'Yes',
            productReviews: 'Highly rated.',
            futureVersions: ['v3.0 due in late 2026']
          }
        ]
      });

      // 4. Customer Intelligence & 27. Customer Intelligence
      bulkOps.CustomerIntelligence.push({
        ticker,
        customerConcentration: 'Moderate. Top 3 customers account for 25% of revenues.',
        governmentContracts: 'Holds active multi-year defense supply agreements.',
        longTermContracts: 'Standard service level agreements with corporate clients.',
        majorCustomersList: [
          {
            customerName: 'Reliance Industries',
            industry: 'Energy & Retail',
            country: 'India',
            relationshipSince: 2017,
            annualRevenueGenerated: mCap * 0.02,
            revenuePercentage: 10,
            contractDuration: '3 Years',
            renewalDate: '2027-12-31',
            dependencyLevel: 'Low',
            exclusiveSupplier: 'No',
            customerCreditRisk: 'Low'
          }
        ]
      });

      // 5. Supplier Intelligence & 28. Supplier Intelligence
      bulkOps.SupplierIntelligence.push({
        ticker,
        suppliersList: [
          {
            supplierName: 'Global Semiconductor Corp',
            rawMaterial: 'Semiconductors & Chips',
            country: 'Taiwan',
            costContribution: 35,
            alternativeSuppliers: ['US Microchips Inc'],
            contractDuration: '2 Years',
            supplyRisk: 'Medium',
            currencyExposure: 'USD',
            esgRating: 'A'
          }
        ]
      });

      // 6. Manufacturing & Operations & 29. Manufacturing Intelligence
      bulkOps.ManufacturingOperations.push({
        ticker,
        period: 'FY26',
        industryType: 'OTHER',
        metrics: {
          'Gross Margin (%)': '45.0%',
          'Operating Margin (%)': '18.0%',
          'EBITDA Margin (%)': '22.0%'
        },
        manufacturingIntelligence: {
          numberOfPlants: 3,
          plantLocations: 'Gujarat, Tamil Nadu',
          plantCapacity: '1,500,000 units/year',
          capacityUtilization: 82.5,
          automationLevel: 'High',
          expansionPlans: 'Capacity expansion in Gujarat plant in FY27.',
          productionCost: price * 0.35,
          productionVolume: 1235000,
          downtime: '1.2%',
          manufacturingTechnology: 'Robotic Assembly Lines',
          certifications: ['ISO 9001', 'ISO 14001']
        }
      });

      // 7. Financial Statements (Consolidated Annual & Quarterly)
      const baseRev = mCap * 0.18;
      const growthRate = randBetween(0.06, 0.14);

      // Annual (10 years)
      for (let y = 0; y < 10; y++) {
        const year = 2017 + y;
        const gFactor = Math.pow(1 + growthRate, y - 9);
        const revenue = Number((baseRev * gFactor).toFixed(2));
        const netProfit = Number((revenue * 0.12).toFixed(2));
        const ebitda = Number((revenue * 0.22).toFixed(2));
        
        bulkOps.FinancialStatement.push({
          ticker, period: 'Annual', periodValue: String(year),
          revenue, grossProfit: revenue * 0.45, ebitda, operatingProfit: ebitda * 0.85,
          profitBeforeTax: ebitda * 0.8, netProfit, eps: Number((netProfit * 10 / price).toFixed(2)),
          ebitdaMargin: 22.0, netMargin: 12.0, totalAssets: mCap * 0.8, totalLiabilities: mCap * 0.35,
          totalDebt: mCap * 0.15, cashEquivalents: mCap * 0.05, shareholderEquity: mCap * 0.45,
          workingCapital: mCap * 0.18, operatingCashFlow: netProfit * 1.1, investingCashFlow: -ebitda * 0.25,
          financingCashFlow: -netProfit * 0.4, freeCashFlow: netProfit * 0.7, capEx: ebitda * 0.25
        });
      }

      // Quarterly (20 quarters)
      for (let y = 0; y < 5; y++) {
        const year = 2021 + y;
        const gFactor = Math.pow(1 + growthRate, y - 4);
        const annualRev = baseRev * gFactor;

        ['Q1', 'Q2', 'Q3', 'Q4'].forEach(q => {
          const qName = `${q} ${year}`;
          const revenue = Number((annualRev / 4).toFixed(2));
          const netProfit = Number((revenue * 0.12).toFixed(2));
          const ebitda = Number((revenue * 0.22).toFixed(2));

          bulkOps.FinancialStatement.push({
            ticker, period: 'Quarterly', periodValue: qName,
            revenue, grossProfit: revenue * 0.45, ebitda, operatingProfit: ebitda * 0.85,
            profitBeforeTax: ebitda * 0.8, netProfit, eps: Number((netProfit * 10 / price).toFixed(2)) / 4,
            ebitdaMargin: 22.0, netMargin: 12.0, totalAssets: mCap * 0.8, totalLiabilities: mCap * 0.35,
            totalDebt: mCap * 0.15, cashEquivalents: mCap * 0.05, shareholderEquity: mCap * 0.45,
            workingCapital: mCap * 0.18, operatingCashFlow: (netProfit / 4) * 1.1, investingCashFlow: -(ebitda / 4) * 0.25,
            financingCashFlow: -(netProfit / 4) * 0.4, freeCashFlow: (netProfit / 4) * 0.7, capEx: (ebitda / 4) * 0.25
          });
        });
      }

      // 8. Financial Ratios
      bulkOps.FinancialRatio.push({
        ticker, period: 'Annual', periodValue: '2026',
        peRatio: Number((price / 12.5).toFixed(2)),
        pbRatio: 3.8,
        pegRatio: 1.5,
        evEbitda: 15.0,
        priceSales: 3.0,
        roe: 18.0,
        roce: 20.0,
        roa: 8.0,
        currentRatio: 1.5,
        quickRatio: 1.2,
        debtToEquity: 0.15,
        interestCoverage: 8.0
      });

      // 9. Shareholding & Ownership & 35. Institutional Holdings
      bulkOps.ShareholdingOwnership.push({
        ticker, quarter: 'Q4 2025',
        promoterHolding: 55.5,
        fiiHolding: 18.2,
        diiHolding: 12.4,
        mutualFunds: 6.8,
        retailInvestors: 13.9,
        governmentHolding: 0.1,
        promoterPledge: 0.0,
        insiderHoldings: 55.5,
        mutualFundsList: [
          { fundName: 'SBI Bluechip Fund', holding: 3.2, purchaseDate: '2025-06-20', averageCost: price * 0.95 },
          { fundName: 'HDFC Top 100 Fund', holding: 2.1, purchaseDate: '2025-08-14', averageCost: price * 0.98 }
        ],
        fiisList: [
          { institution: 'Vanguard Emerging Markets', country: 'USA', holdingPercentage: 8.4, quarterlyChange: 0.15 },
          { institution: 'BlackRock Global Fund', country: 'USA', holdingPercentage: 6.2, quarterlyChange: -0.05 }
        ]
      });

      // 10. Management & Governance & 33. Management Intelligence
      bulkOps.ManagementGovernance.push({
        ticker,
        managingDirector: getRandomName(),
        cfo: getRandomName(),
        chairman: getRandomName(),
        boardMembers: [
          { name: getRandomName(), role: 'Executive Chairman', isIndependent: false },
          { name: getRandomName(), role: 'Independent Director', isIndependent: true }
        ],
        independentDirectors: [getRandomName(), getRandomName()],
        promoterDetails: 'Controlled by founders.',
        keyExecutivesList: [
          {
            name: getRandomName(), age: 52, qualification: 'MBA from Harvard',
            experience: '25 years in corporate operations', previousCompanies: ['Global Conglomerate Corp'],
            joiningDate: '2020-05-10', sharesOwned: 5000, salary: 50000000, bonus: 10000000,
            esop: 2000, tenure: '6 Years', performanceRecord: 'Scaled digital operations.',
            publicInterviews: 'https://youtube.com/interview', managementStyle: 'Collaborative'
          }
        ]
      });

      // 11. Competitor Intelligence & 36. Competitor Intelligence
      bulkOps.CompetitorIntelligence.push({
        ticker,
        marketPosition: 2,
        marketShare: 25,
        competitiveAdvantage: 'Proprietary tech, strong supply chain.',
        weaknesses: 'International brand recognition.',
        pricingStrategy: 'Premium.',
        productComparison: 'High uptime and SLA support.',
        competitorsList: [
          {
            competitorName: 'Competitor Alpha',
            revenue: baseRev * 0.9,
            profit: baseRev * 0.1,
            marketCap: mCap * 0.85,
            pe: 24.5, roe: 16.5, debt: mCap * 0.12, growth: '10.5%', pricing: 'Premium',
            products: ['Alpha Core Pro'], technology: 'Cloud Infra', employeeCount: 15000,
            customerBase: '1200+ clients', marketShare: 20, swot: { strengths: ['Global sales'] },
            moatComparison: 'Fewer patents.'
          }
        ]
      });

      // 12. Industry & Market Analysis & 37. Industry Intelligence
      bulkOps.IndustryMarketAnalysis.push({
        ticker,
        industrySize: '₹2,50,000 Crores',
        cagr: '12.4%',
        topPlayers: [name, 'Competitor Alpha'],
        entryBarriers: 'Capital and regulatory hurdles.',
        regulations: 'Standard industrial compliance acts.',
        governmentPolicies: 'Supported by local PLI schemes.',
        imports: 'Low.', exports: '30%.', demandDrivers: 'Urbanization, cloud migration.',
        technologyChanges: 'AI automation.', risks: 'Commodity inflation.'
      });

      // 13. Macroeconomic Indicators & 38. Economic Indicators
      bulkOps.MacroeconomicIndicator.push({
        ticker,
        inflation: '5.2%', interestRate: '6.5%', gdpGrowth: '7.2%', currencyExchange: '83.4 INR/USD',
        oilPrices: '82 USD/Barrel', goldPrices: '72,000 INR/10g', commodityPrices: 'Stable.', taxChanges: '18% GST.'
      });

      // 14. News, Events & Earnings Calls & 47. Earnings Call Database
      bulkOps.NewsEventsEarnings.push({
        ticker,
        newsList: [
          { title: `${ticker} quarterly earnings beat`, description: 'Earnings beat driven by strong client addition.', date: new Date(), category: 'EARNINGS', source: 'Moneycontrol', link: 'https://moneycontrol.com' }
        ],
        earningsCallsList: [
          {
            quarter: 'Q3 FY26', transcript: 'Operator: Welcome... CEO: Strong margins this quarter.',
            ceoCommentary: 'Strong demand from core clients drove margin expansion.',
            cfoCommentary: 'Cash conversion remains high.', futureGuidance: '12-14% growth next year.',
            analystQuestions: 'Is margin sustainable?', managementAnswers: 'Yes.',
            risksMentioned: 'Supply chain friction.', opportunitiesMentioned: 'AI adoption.'
          }
        ]
      });

      // 15. Legal & Compliance & 43. Legal Database
      bulkOps.LegalCompliance.push({
        ticker,
        courtCases: 'None.', sebiNotices: 'None.', taxNotices: 'None.', regulatoryActions: 'None.', environmentalCases: 'None.', consumerComplaints: 'None.'
      });

      // 16. Corporate Actions
      bulkOps.CorporateAction.push({
        ticker,
        actionsList: [
          { actionType: 'DIVIDEND', exDate: new Date('2026-02-15'), recordDate: new Date('2026-02-16'), ratioOrAmount: '12.50', description: 'Interim Dividend.' }
        ]
      });

      // 17. Price & Technical Data & 13. Technical Indicators & 46. Share Price Events
      let currentStockPrice = price;
      const historyLength = 60;
      const pricesList = [];
      const today = new Date();

      for (let i = 0; i < historyLength; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        if (d.getDay() === 0 || d.getDay() === 6) continue;

        const returnPct = randBetween(-0.015, 0.015);
        const open = Number((currentStockPrice * (1 - returnPct * 0.1)).toFixed(2));
        const close = Number(currentStockPrice.toFixed(2));
        const high = Number((Math.max(open, close) * randBetween(1.0, 1.015)).toFixed(2));
        const low = Number((Math.min(open, close) * randBetween(0.985, 1.0)).toFixed(2));
        const volume = randIntBetween(100000, 2000000);
        const vwap = Number(((open + high + low + close) / 4).toFixed(2));

        pricesList.unshift({
          ticker, date: new Date(d), open, high, low, close, volume,
          deliveryVolume: Math.floor(volume * 0.45), vwap,
          fiftyTwoWeekHigh: Number((price * 1.2).toFixed(2)),
          fiftyTwoWeekLow: Number((price * 0.8).toFixed(2)),
          allTimeHigh: Number((price * 1.5).toFixed(2)),
          marketCap: mCap, freeFloat: Number((mCap * 0.45).toFixed(2))
        });

        currentStockPrice = currentStockPrice / (1 + returnPct);
      }

      for (let pIdx = 0; pIdx < pricesList.length; pIdx++) {
        const pObj = pricesList[pIdx];

        const getSma = (period) => {
          if (pIdx < period) return pObj.close;
          let sum = 0;
          for (let k = 0; k < period; k++) {
            sum += pricesList[pIdx - k].close;
          }
          return Number((sum / period).toFixed(2));
        };

        const sma20 = getSma(10);
        const sma50 = getSma(20);
        const sma100 = getSma(30);
        const sma200 = getSma(40);

        let rsi = 50;
        if (pIdx >= 14) {
          let gains = 0, losses = 0;
          for (let k = 0; k < 14; k++) {
            const diff = pricesList[pIdx - k].close - pricesList[pIdx - k - 1].close;
            if (diff > 0) gains += diff;
            else losses -= diff;
          }
          rsi = Number((100 - 100 / (1 + (gains / (losses || 1)))).toFixed(2));
        }

        let stdDev = 0.02 * pObj.close;
        if (pIdx >= 10) {
          let sumDiffSq = 0;
          for (let k = 0; k < 10; k++) {
            sumDiffSq += Math.pow(pricesList[pIdx - k].close - sma20, 2);
          }
          stdDev = Math.sqrt(sumDiffSq / 10);
        }

        bulkOps.PriceTechnicalData.push({
          ticker, date: pObj.date, ...pObj,
          sma: { sma20, sma50, sma100, sma200 },
          ema: { ema20: sma20, ema50: sma50 },
          rsi,
          macd: { macdLine: Number((sma20 - sma50).toFixed(2)), signalLine: Number(((sma20 - sma50) * 0.9).toFixed(2)), histogram: Number(((sma20 - sma50) * 0.1).toFixed(2)) },
          bollingerBands: { upper: Number((sma20 + 2 * stdDev).toFixed(2)), middle: sma20, lower: Number((sma20 - 2 * stdDev).toFixed(2)) },
          atr: Number((pObj.high - pObj.low).toFixed(2)), adx: randIntBetween(20, 45), supertrend: Number((pObj.close * 1.01).toFixed(2)),
          stochasticRsi: { k: randIntBetween(20, 80), d: randIntBetween(20, 80) }, obv: randIntBetween(1000000, 50000000), volumeProfile: 'High volume support.',
          priceEvents: {
            beforeEarnings: pObj.close * 0.98, afterEarnings: pObj.close * 1.03,
            beforeBudget: pObj.close * 0.99, afterBudget: pObj.close * 1.01,
            afterDividend: pObj.close * 0.995, afterSplit: pObj.close, afterBonus: pObj.close, marketCrashPrice: pObj.close * 0.85
          }
        });
      }

      // 18. Analyst & Valuation Models & 48. Investment Thesis Database
      bulkOps.AnalystValuationModel.push({
        ticker, consensusTargetPrice: Number((price * 1.15).toFixed(2)),
        buyRatings: randIntBetween(12, 28), holdRatings: randIntBetween(3, 10), sellRatings: randIntBetween(0, 4),
        earningsForecast: '12.5% increase forecasted.', revenueForecast: 'Single digit revenue expansion projected.',
        investmentThesis: {
          bullCase: 'Strong moat, clean sheet.', whyBuy: 'High capital returns.',
          bearCase: 'Talent attrition bottlenecks.', whyAvoid: 'Interest rate cycles.',
          catalysts: 'New development center opening.', thesisRisks: 'Supply chain bottlenecks.',
          fairValue: Number((price * 1.05).toFixed(2)), dcfValue: Number((price * 1.02).toFixed(2)),
          relativeValuation: 'Trading in line with forward PEs.', targetPrice: Number((price * 1.15).toFixed(2))
        }
      });

      // 19. ESG & Sustainability & 45. ESG Intelligence
      bulkOps.ESGSustainability.push({
        ticker, year: 2025, esgScore: randIntBetween(65, 88), environmentalScore: randIntBetween(60, 85),
        socialScore: randIntBetween(70, 90), governanceScore: randIntBetween(75, 92),
        environmental: { carbonEmissions: 'Low-to-Medium Carbon footprint.', renewableEnergyPercentage: 35, waterUsage: 'Zero water index program.', wasteRecycling: 'Zero waste campus.' },
        social: { employeeSafety: 'Zero harm audits.', genderDiversity: 28, csrSpending: mCap * 0.002 },
        governance: { boardIndependence: 60, auditQuality: 'Top tier firm audits.', promoterEthics: 'Clean track record.' }
      });

      // 20. AI Knowledge Base & 30. R&D & 31. Patent Database & 32. Employee Intelligence & 41. Digital Presence & 42. AI Adoption & 44. Acquisition Database & 49. AI-Ready Knowledge Base
      bulkOps.AIKnowledgeBase.push({
        ticker,
        rnd: { annualSpending: mCap * 0.015, percentageOfRevenue: 4.5, numberOfResearchers: 120, numberOfPatents: 154, activePatents: 124, expiredPatents: 12, pendingPatents: 18, researchAreas: ['AI', 'Quantum computing'], innovationPipeline: ['NextGen cloud modules'] },
        patentsList: [{ patentId: 'PAT-2024-01', patentName: 'Predictive data pipeline', country: 'India', filingDate: '2024-02-12', expiryDate: '2044-02-12', technologyArea: 'ML', revenueGenerated: mCap * 0.008, licensingIncome: mCap * 0.001 }],
        employees: { totalEmployees: 25000, engineers: 15000, salesEmployees: 3000, factoryWorkers: 4000, averageSalary: 850000, attritionRate: '12.4%', employeeSatisfaction: '4.2/5 rating', diversity: '28% female ratio', hiringTrend: 'Active hiring.', layoffs: 'None.', trainingHours: '40 hours/employee/year', employeeProductivity: 'High output.' },
        digitalPresence: { websiteTraffic: '120k monthly visitors', mobileAppDownloads: '500,000+', appRatings: '4.6/5 stars', linkedinFollowers: '75,000', twitterFollowers: '25,000', youtubeSubscribers: '12,000', brandMentions: 'Positive.' },
        techAdoption: { aiUsage: 'Deep learning recommendations.', cloudProvider: 'AWS & Azure', erp: 'SAP S/4HANA', crm: 'Salesforce', cybersecurity: 'ISO 27001 Certified', digitalTransformation: 'Cloud-native.', automationLevel: '85%' },
        acquisitionsList: [{ companyAcquired: 'AeroTech Systems Pvt Ltd', date: '2023-08-14', cost: mCap * 0.05, reason: 'Acquire telemetry tech.', revenueAdded: mCap * 0.005, employeesAdded: 80, roi: '18%', successStatus: 'Success' }],
        aiReadyStats: {
          swotAnalysis: { strengths: ['Debt-free balance sheet'], weaknesses: ['High dependency on government contracts'], opportunities: ['Overseas cloud licensing'], threats: ['Wage pressure'] },
          porterFiveForces: { barrierToEntry: 'High.', supplierPower: 'Low.', buyerPower: 'Moderate.', threatOfSubstitutes: 'Low.', competitiveRivalry: 'Moderate.' },
          valueChainAnalysis: 'Optimized inbound and outbound logistics.', industryOutlook: '12% CAGR outlook.',
          scores: { managementQuality: 88, financialHealth: 92, growth: 85, valuation: 75, risk: 15, esg: 78, overallInvestment: 82, confidence: 90 }
        }
      });
    }

    console.log('\nTruncating and seeding new 20 consolidated collections...');
    const keys = Object.keys(collections);
    const BATCH_SIZE = 5000;

    for (const key of keys) {
      const ops = bulkOps[key];
      if (ops.length > 0) {
        console.log(`Clearing collection '${collections[key].collection.name}'...`);
        await collections[key].collection.deleteMany({});
        
        console.log(`Inserting ${ops.length} records into '${collections[key].collection.name}' in chunks of ${BATCH_SIZE}...`);
        let inserted = 0;
        for (let i = 0; i < ops.length; i += BATCH_SIZE) {
          const chunk = ops.slice(i, i + BATCH_SIZE);
          const result = await collections[key].collection.insertMany(chunk, { ordered: false });
          inserted += (result.insertedCount || Object.keys(result.insertedIds || {}).length || chunk.length);
        }
        console.log(`- '${key}' done: inserted=${inserted} documents`);
      }
    }

    console.log('\nConsolidated Database Seeding Completed successfully!');
  } catch (error) {
    console.error('Fatal error during seeding:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed.');
    process.exit(0);
  }
}

seedConsolidatedData();
