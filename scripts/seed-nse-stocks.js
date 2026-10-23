const fs = require('fs');
const path = require('path');
const https = require('https');
const mongoose = require('mongoose');

// 1. Parse .env.local file for MongoDB URI
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

// 2. Define Mongoose Schemas
const StockSchema = new mongoose.Schema({
  ticker: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  change: { type: Number, default: 0 },
  changePercent: { type: Number, default: 0 },
  high: { type: Number, default: 0 },
  low: { type: Number, default: 0 },
  volume: { type: Number, default: 0 },
  marketCap: { type: Number, default: 0 },
  sector: { type: String, default: 'Other' },
  isFallback: { type: Boolean, default: false },
  lastUpdated: { type: Date, default: Date.now }
}, { timestamps: true });

const Stock = mongoose.models.Stock || mongoose.model('Stock', StockSchema);

const CompanyProfileSchema = new mongoose.Schema({
  ticker: { type: String, required: true, unique: true, index: true },
  ceo: { type: String, default: 'N/A' },
  cfo: { type: String, default: 'N/A' },
  cto: { type: String, default: 'N/A' },
  description: { type: String, default: 'No company description available.' },
  holdings: {
    promoter: { type: Number, default: 50.0 },
    institutional: { type: Number, default: 25.0 },
    public: { type: Number, default: 25.0 }
  },
  mutualFunds: {
    type: [{
      name: String,
      holding: Number,
      change: Number
    }],
    default: []
  },
  majorClients: {
    type: [String],
    default: []
  },
  parentCompany: { type: String, default: null },
  subsidiaries: { type: [String], default: [] },
  partners: { type: [String], default: [] },
  financials: {
    peRatio: { type: Number, default: 0 },
    pbRatio: { type: Number, default: 0 },
    roe: { type: Number, default: 0 },
    debtToEquity: { type: Number, default: 0 }
  },
  revenueBreakdown: {
    geography: [{ region: String, percentage: Number }],
    segments: [{ name: String, percentage: Number }]
  },
  dividends: {
    yield: { type: Number, default: 0 },
    nextDate: { type: String, default: 'N/A' },
    history: [{ date: String, amount: Number }]
  },
  earnings: {
    nextDate: { type: String, default: 'N/A' },
    history: [{ quarter: String, actualEps: Number, estimatedEps: Number }]
  },
  insiderTrading: [{ name: String, role: String, type: { type: String, enum: ['BUY', 'SELL'] }, shares: Number, date: String }],
  optionsSentiment: {
    shortInterest: { type: Number, default: 0 },
    putCallRatio: { type: Number, default: 0 }
  },
  analystRatings: {
    strongBuy: { type: Number, default: 0 },
    buy: { type: Number, default: 0 },
    hold: { type: Number, default: 0 },
    sell: { type: Number, default: 0 },
    strongSell: { type: Number, default: 0 },
    targetPrice: { type: Number, default: 0 }
  },
  riskMetrics: {
    maxDrawdown: { type: Number, default: 0 },
    recoveryDays: { type: Number, default: 0 }
  },
  peers: [{ ticker: String, peRatio: Number, pbRatio: Number, roe: Number }],
  esg: {
    environmental: { type: Number, default: 0 },
    social: { type: Number, default: 0 },
    governance: { type: Number, default: 0 },
    total: { type: Number, default: 0 }
  },
  socialSentiment: [{ platform: String, mentionVolume: Number, sentimentScore: Number }],
  hiringTrends: { openPositions: { type: Number, default: 0 }, monthOverMonthChange: { type: Number, default: 0 }, keyRoles: [String] },
  webTraffic: { monthlyVisitors: { type: Number, default: 0 }, bounceRate: { type: Number, default: 0 }, globalRank: { type: Number, default: 0 } },
  cashFlow: { operating: { type: Number, default: 0 }, investing: { type: Number, default: 0 }, financing: { type: Number, default: 0 } },
  sectorKpis: [{ metricName: String, value: String, yoyChange: Number }],
  macroCorrelations: [{ factor: String, correlationCoefficient: Number }],
  supplyChain: { suppliers: [String], distributors: [String] },
  execCompensation: [{ name: String, role: String, salary: Number, stockAwards: Number }],
  patents: { activeCount: { type: Number, default: 0 }, keyAreas: [String] },
  regulatoryFilings: [{ formType: String, date: String, description: String }]
}, { timestamps: true });

const CompanyProfile = mongoose.models.CompanyProfile || mongoose.model('CompanyProfile', CompanyProfileSchema);

// Existing known fallback prices to map exact initial values for famous stocks
const FAMOUS_FALLBACK_PRICES = {
  RELIANCE: 2950.50, TCS: 3910.20, HDFCBANK: 1680.80, INFY: 1540.40, ICICIBANK: 1185.15,
  ITC: 435.50, SBIN: 825.40, BHARTIARTL: 1415.00, LTIM: 5150.00, LT: 3450.00,
  KOTAKBANK: 1780.00, HINDUNILVR: 2450.00, MARUTI: 12100.00, TATASTEEL: 170.50, WIPRO: 480.00,
  AXISBANK: 1150.00, ASIANPAINT: 2850.00, "M&M": 2800.00, BAJFINANCE: 6900.00, SUNPHARMA: 1500.00,
  ADANIENT: 3150.00, NTPC: 370.00, ONGC: 265.00, TITAN: 3250.00, TATAMOTORS: 960.00,
  IRFC: 175.40, SUZLON: 65.10, SWIGGY: 450.00, JIOFIN: 350.00, OLAELEC: 78.00,
  TATAPOWER: 440.00, RVNL: 410.00, PNB: 125.00, CANBK: 118.00, IDEA: 16.80
};

const FAMOUS_METADATA = {
  RELIANCE: { sector: "Conglomerate & Energy", marketCap: 1980000 },
  TCS: { sector: "Technology", marketCap: 1420000 },
  HDFCBANK: { sector: "Banking & Finance", marketCap: 1280000 },
  INFY: { sector: "Technology", marketCap: 640000 },
  ICICIBANK: { sector: "Banking & Finance", marketCap: 830000 },
  ITC: { sector: "FMCG & Retail", marketCap: 530000 },
  SBIN: { sector: "Banking & Finance", marketCap: 730000 },
  BHARTIARTL: { sector: "Telecom & Networking", marketCap: 820000 },
  LTIM: { sector: "Technology", marketCap: 152000 },
  LT: { sector: "Infrastructure & Heavy Engineering", marketCap: 480000 },
  KOTAKBANK: { sector: "Banking & Finance", marketCap: 350000 },
  HINDUNILVR: { sector: "FMCG & Retail", marketCap: 570000 },
  MARUTI: { sector: "Automotive", marketCap: 380000 },
  TATASTEEL: { sector: "Metals & Mining", marketCap: 210000 },
  WIPRO: { sector: "Technology", marketCap: 250000 },
  AXISBANK: { sector: "Banking & Finance", marketCap: 360000 },
  ASIANPAINT: { sector: "Chemicals & Paints", marketCap: 270000 },
  "M&M": { sector: "Automotive & Conglomerate", marketCap: 340000 },
  BAJFINANCE: { sector: "Banking & Finance", marketCap: 420000 },
  SUNPHARMA: { sector: "Healthcare & Pharma", marketCap: 360000 },
  ADANIENT: { sector: "Conglomerate & Infra", marketCap: 350000 },
  NTPC: { sector: "Utilities & Energy", marketCap: 360000 },
  ONGC: { sector: "Utilities & Energy", marketCap: 330000 },
  TITAN: { sector: "FMCG & Retail", marketCap: 290000 },
  TATAMOTORS: { sector: "Automotive", marketCap: 340000 },
  IRFC: { sector: "Banking & Finance", marketCap: 228000 },
  SUZLON: { sector: "Utilities & Energy", marketCap: 88000 },
  SWIGGY: { sector: "Consumer Services & Tech", marketCap: 95000 },
  JIOFIN: { sector: "Banking & Finance", marketCap: 220000 },
  OLAELEC: { sector: "Automotive", marketCap: 34000 },
  TATAPOWER: { sector: "Utilities & Energy", marketCap: 140000 },
  RVNL: { sector: "Infrastructure & Heavy Engineering", marketCap: 85000 },
  PNB: { sector: "Banking & Finance", marketCap: 138000 }
};

const FAMOUS_PROFILES = {
  RELIANCE: {
    ceo: "Mukesh Ambani",
    cfo: "Srikanth Venkatachari",
    cto: "Jyotindra Thacker",
    description: "Reliance Industries Limited is a diversified conglomerate based in Mumbai. It operates across energy, petrochemicals, natural gas, retail, telecommunications, mass media, and textiles.",
    holdings: { promoter: 50.39, institutional: 29.85, public: 19.76 }
  },
  TCS: {
    ceo: "K. Krithivasan",
    cfo: "Samir Seksaria",
    cto: "Abhijit Mazumdar",
    description: "Tata Consultancy Services Limited is a multinational information technology services and consulting company. It is a subsidiary of the Tata Group and operates in 150 locations across 46 countries.",
    holdings: { promoter: 72.4, institutional: 22.1, public: 5.5 }
  },
  HDFCBANK: {
    ceo: "Sashidhar Jagdishan",
    cfo: "Srinivasan Vaidyanathan",
    cto: "Ramesh Lakshminarayanan",
    description: "HDFC Bank Limited is an Indian banking and financial services company headquartered in Mumbai. It is India's largest private sector bank by assets and the world's tenth-largest bank by market capitalization.",
    holdings: { promoter: 0.0, institutional: 81.3, public: 18.7 }
  },
  INFY: {
    ceo: "Salil Parekh",
    cfo: "Jayesh Sanghrajka",
    cto: "Mohammed Rafee Tarafdar",
    description: "Infosys Limited is a multinational information technology company that provides business consulting, information technology, and outsourcing services. It was founded in Pune and is headquartered in Bangalore.",
    holdings: { promoter: 14.9, institutional: 66.8, public: 18.3 }
  },
  SBIN: {
    ceo: "Dinesh Kumar Khara",
    cfo: "Kameshwar Rao Kodavanti",
    cto: "Amit Saxena",
    description: "State Bank of India is an Indian multinational public sector bank and financial services statutory body. Headquartered in Mumbai, SBI has a 23% market share in assets and a 1/4th share of the total deposits and advances market.",
    holdings: { promoter: 57.5, institutional: 34.2, public: 8.3 }
  }
};

const INDIAN_FIRST_NAMES = ['Rajesh', 'Sanjay', 'Amit', 'Vikram', 'Anil', 'Sunil', 'Vijay', 'Rahul', 'Deepak', 'Arvind', 'Priya', 'Anjali', 'Karan', 'Rohan', 'Neeraj', 'Meera', 'Ramesh', 'Harish', 'Gautam'];
const INDIAN_LAST_NAMES = ['Sharma', 'Mehta', 'Patel', 'Joshi', 'Gupta', 'Chauhan', 'Singhal', 'Reddy', 'Nair', 'Iyer', 'Sen', 'Das', 'Roy', 'Verma', 'Kumar', 'Kapoor', 'Prasad', 'Mishra'];

// 3. Helper to fetch file from URL using native https module with proper headers
function fetchCsv(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.nseindia.com/market-data/securities-available-for-trading'
      }
    };

    https.get(url, options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download CSV: Status code ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        resolve(data);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// 4. Main Seed Function
async function seedAllStocks() {
  console.log('Seeding ALL Indian Stocks from NSE equity list...');
  
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongodbUri);
    console.log('MongoDB connected successfully.');

    // URL to get the complete list of equity segment symbols from NSE
    const csvUrl = 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv';
    console.log(`Downloading stock list from: ${csvUrl}...`);
    
    let csvData;
    try {
      csvData = await fetchCsv(csvUrl);
      console.log('CSV downloaded successfully.');
    } catch (fetchError) {
      console.warn('Direct NSE download failed. Trying fallback mirror URL...');
      const mirrorUrl = 'https://raw.githubusercontent.com/shihab1011/nse-stocks-list/main/EQUITY_L.csv';
      csvData = await fetchCsv(mirrorUrl);
      console.log('CSV downloaded from fallback mirror successfully.');
    }

    // Helper to parse a single CSV line respecting quotes and embedded commas
    function parseCsvLine(line) {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    }

    const lines = csvData.split(/\r?\n/);
    const stocksData = [];
    const profilesData = [];

    console.log('Parsing stock rows...');
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const matches = parseCsvLine(line);
      if (matches.length < 3) continue;

      const ticker = matches[0].replace(/"/g, '').trim();
      const name = matches[1].replace(/"/g, '').trim();
      const series = matches[2].replace(/"/g, '').trim();

      if (series !== 'EQ') continue;

      let initialPrice = FAMOUS_FALLBACK_PRICES[ticker];
      if (!initialPrice) {
        initialPrice = Number((Math.random() * 1490 + 10).toFixed(2));
      }

      let sector = "Other";
      let marketCap = 0;
      if (FAMOUS_METADATA[ticker]) {
        sector = FAMOUS_METADATA[ticker].sector;
        marketCap = FAMOUS_METADATA[ticker].marketCap;
      } else {
        const sectors = ["Banking & Finance", "Technology", "Consumer Goods", "Utilities & Energy", "Automotive", "Healthcare & Pharma", "Infrastructure", "Metals & Mining", "Chemicals", "Telecom", "Real Estate"];
        sector = sectors[Math.floor(Math.random() * sectors.length)];
        marketCap = Math.floor(Math.random() * 14900) + 100;
      }

      stocksData.push({
        ticker,
        name,
        price: initialPrice,
        change: Number((initialPrice * (Math.random() - 0.5) * 0.02).toFixed(2)),
        changePercent: Number(((Math.random() - 0.5) * 2).toFixed(2)),
        high: Number((initialPrice * 1.01).toFixed(2)),
        low: Number((initialPrice * 0.99).toFixed(2)),
        volume: Math.floor(Math.random() * 1000000) + 1000,
        marketCap,
        sector,
        isFallback: true
      });

      // Generate profiles data
      let ceo = "N/A", cfo = "N/A", cto = "N/A", description = "", holdings = { promoter: 50, institutional: 25, public: 25 };
      if (FAMOUS_PROFILES[ticker]) {
        ceo = FAMOUS_PROFILES[ticker].ceo;
        cfo = FAMOUS_PROFILES[ticker].cfo;
        cto = FAMOUS_PROFILES[ticker].cto;
        description = FAMOUS_PROFILES[ticker].description;
        holdings = FAMOUS_PROFILES[ticker].holdings;
      } else {
        const getRandomName = () => {
          const fn = INDIAN_FIRST_NAMES[Math.floor(Math.random() * INDIAN_FIRST_NAMES.length)];
          const ln = INDIAN_LAST_NAMES[Math.floor(Math.random() * INDIAN_LAST_NAMES.length)];
          return `${fn} ${ln}`;
        };
        ceo = getRandomName();
        cfo = getRandomName();
        cto = getRandomName();
        description = `${name} is a leading player in the ${sector} sector. Headquartered in India, the company specializes in high-quality industrial solutions, services, and product deliveries designed to optimize stakeholder value and operational excellence. The company continues to pioneer new benchmarks across its business lines.`;
        
        const promoterVal = Number((Math.random() * 30 + 45).toFixed(2));
        const instVal = Number((Math.random() * 20 + 10).toFixed(2));
        const publicVal = Number((100 - promoterVal - instVal).toFixed(2));
        holdings = {
          promoter: promoterVal,
          institutional: instVal,
          public: publicVal
        };
      }

      // Generate mutual funds holding distribution dynamically
      const mfNames = [
        "SBI Bluechip Fund", 
        "HDFC Mid-Cap Opportunities Fund", 
        "ICICI Prudential Bluechip Fund", 
        "Axis Bluechip Fund", 
        "Mirae Asset Large Cap Fund", 
        "Nippon India Small Cap Fund", 
        "Quant Active Fund", 
        "Parag Parikh Flexi Cap Fund", 
        "UTI Nifty 50 Index Fund", 
        "Kotak Emerging Equity Fund"
      ];
      const shuffled = mfNames.sort(() => 0.5 - Math.random());
      const selectedFunds = shuffled.slice(0, Math.floor(Math.random() * 2) + 3); // 3 or 4 funds
      const totalMfStake = holdings.institutional * 0.6;
      let remainingStake = totalMfStake;
      const mutualFunds = selectedFunds.map((fund, idx) => {
        let stake = 0;
        if (idx === selectedFunds.length - 1) {
          stake = Number(remainingStake.toFixed(2));
        } else {
          stake = Number((Math.random() * (remainingStake / 2) + 0.5).toFixed(2));
          remainingStake -= stake;
        }
        const changeVal = Number((Math.random() * 0.8 - 0.4).toFixed(2)); // Between -0.4% and +0.4%
        return {
          name: fund,
          holding: stake,
          change: changeVal
        };
      });

      // Generate major clients dynamically
      const possibleClients = [
        "Reliance Industries", "Tata Motors", "Indian Oil", "Larsen & Toubro", 
        "Apple Inc.", "Amazon Web Services", "Microsoft", "Google India", 
        "Samsung Electronics", "Walmart", "State Bank of India", "Adani Group", 
        "Siemens India", "General Electric", "Intel Corp.", "Sony Corporation", 
        "Government of India", "ISRO", "DRDO", "Bharat Petroleum", "Infosys", "Wipro"
      ];
      const shuffledClients = possibleClients.sort(() => 0.5 - Math.random());
      const majorClients = shuffledClients.slice(0, Math.floor(Math.random() * 3) + 3); // 3 to 5 clients

      profilesData.push({
        ticker,
        ceo,
        cfo,
        cto,
        description,
        holdings,
        mutualFunds,
        majorClients
      });
    }

    console.log(`Parsed ${stocksData.length} valid equity stocks.`);
    console.log('Writing stocks to MongoDB (bulk write)...');

    const bulkOps = stocksData.map((stock) => ({
      updateOne: {
        filter: { ticker: stock.ticker },
        update: {
          $set: {
            name: stock.name,
            price: stock.price,
            change: stock.change,
            changePercent: stock.changePercent,
            high: stock.high,
            low: stock.low,
            volume: stock.volume,
            marketCap: stock.marketCap,
            sector: stock.sector,
            isFallback: stock.isFallback,
            lastUpdated: new Date()
          }
        },
        upsert: true
      }
    }));

    const batchSize = 1000;
    let matched = 0, modified = 0, upserted = 0;
    
    for (let i = 0; i < bulkOps.length; i += batchSize) {
      const batch = bulkOps.slice(i, i + batchSize);
      console.log(`Writing stock batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(bulkOps.length / batchSize)}...`);
      const result = await Stock.bulkWrite(batch);
      matched += result.matchedCount;
      modified += result.modifiedCount;
      upserted += result.upsertedCount;
    }

    console.log('Writing company profiles to MongoDB (bulk write)...');
    const profileBulkOps = profilesData.map((profile) => ({
      updateOne: {
        filter: { ticker: profile.ticker },
        update: {
          $set: {
            ceo: profile.ceo,
            cfo: profile.cfo,
            cto: profile.cto,
            description: profile.description,
            holdings: profile.holdings,
            mutualFunds: profile.mutualFunds,
            majorClients: profile.majorClients
          }
        },
        upsert: true
      }
    }));

    let pMatched = 0, pModified = 0, pUpserted = 0;
    for (let i = 0; i < profileBulkOps.length; i += batchSize) {
      const batch = profileBulkOps.slice(i, i + batchSize);
      console.log(`Writing profile batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(profileBulkOps.length / batchSize)}...`);
      const result = await CompanyProfile.bulkWrite(batch);
      pMatched += result.matchedCount;
      pModified += result.modifiedCount;
      pUpserted += result.upsertedCount;
    }

    console.log('\nAll Indian stocks & company profiles successfully seeded!');
    console.log(`- Total Stocks Processed: ${stocksData.length}`);
    console.log(`- Stocks Matched/Modified: ${matched}/${modified}`);
    console.log(`- Profiles Matched/Modified: ${pMatched}/${pModified}`);

  } catch (error) {
    console.error('An error occurred during seeding:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed.');
    process.exit(0);
  }
}

seedAllStocks();
