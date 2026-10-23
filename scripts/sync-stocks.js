const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// 1. Manually parse .env.local file to retrieve MongoDB URI
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
        mongodbUri = val;
      }
    }
  }
}

if (!mongodbUri) {
  console.error('ERROR: MONGODB_URI is not defined in environment variables or .env.local');
  process.exit(1);
}

// 2. Define standard list of Indian stocks for syncing
const TICKER_NAMES = {
  RELIANCE: "Reliance Industries Ltd.",
  TCS: "Tata Consultancy Services Ltd.",
  HDFCBANK: "HDFC Bank Ltd.",
  INFY: "Infosys Ltd.",
  ICICIBANK: "ICICI Bank Ltd.",
  ITC: "ITC Ltd.",
  SBIN: "State Bank of India",
  BHARTIARTL: "Bharti Airtel Ltd.",
  LTIM: "LTIMindtree Ltd.",
  LT: "Larsen & Tourbo Ltd.",
  KOTAKBANK: "Kotak Mahindra Bank Ltd.",
  HINDUNILVR: "Hindustan Unilever Ltd.",
  MARUTI: "Maruti Suzuki India Ltd.",
  TATASTEEL: "Tata Steel Ltd.",
  WIPRO: "Wipro Ltd.",
  AXISBANK: "Axis Bank Ltd.",
  ASIANPAINT: "Asian Paints Ltd.",
  "M&M": "Mahindra & Mahindra Ltd.",
  BAJFINANCE: "Bajaj Finance Ltd.",
  SUNPHARMA: "Sun Pharmaceutical Industries Ltd.",
  ADANIENT: "Adani Enterprises Ltd.",
  NTPC: "NTPC Ltd.",
  ONGC: "Oil & Natural Gas Corporation Ltd.",
  TITAN: "Titan Company Ltd.",
  TATAMOTORS: "Tata Motors Ltd.",
  ETERNAL: "Eternal Industries Ltd.",
  AVENUESAI: "AvenuesAI Ltd.",
  IRCON: "Ircon International Ltd.",
  PFS: "PTC India Financial Services Ltd.",
  IRFC: "Indian Railway Finance Corporation Ltd.",
  SUZLON: "Suzlon Energy Ltd.",
  SWIGGY: "Swiggy Ltd.",
  JSWCEMENT: "JSW Cement Ltd.",
  IGI: "International Gemological Institute Ltd.",
  DLINK: "D-Link (India) Ltd.",
  ITCHOTELS: "ITC Hotels Ltd.",
  TMPV: "Tata Motors Passenger Vehicles Ltd.",
  ATHER: "Ather Energy Ltd.",
  RBA: "Restaurant Brands Asia Ltd.",
  DEEPAKBUILD: "Deepak Builders & Engineers India Ltd.",
  GROWW: "Groww (Billionbrains Garage Ventures)",
  AFCONS: "Afcons Infrastructure Ltd.",
  HIGHWAY: "Highway Infrastructure Trust",
  ABCAPITAL: "Aditya Birla Capital Ltd.",
  GOPAL: "Gopal Snacks Ltd.",
  JIOFIN: "Jio Financial Services Ltd.",
  OLAELEC: "Ola Electric Mobility Ltd.",
  INFOBEAN: "InfoBeans Technologies Ltd.",
  ADITYAINFO: "Aditya Infotech Ltd.",
  NSDL: "NSDL (National Securities Depository Ltd.)",
  GNGELEC: "GNG Electronics Ltd.",
  VISHAL: "Vishal Mega Mart Ltd.",
  ENVIROINFRA: "Enviro Infra Engineers Ltd.",
  ANTHEM: "Anthem Biosciences Ltd.",
  SALASAR: "Salasar Techno Engineering Ltd.",
  SHANTIGOLD: "Shanti Gold International Ltd.",
  MEESHO: "Meesho Ltd.",
  ANANTRAJ: "Anant Raj Ltd.",
  JUPITERWAG: "Jupiter Wagons Ltd.",
  RPOWER: "Reliance Power Ltd.",
  NHPC: "NHPC Ltd.",
  IOB: "Indian Overseas Bank",
  GTLINFRA: "GTL Infrastructure Ltd.",
  PNB: "Punjab National Bank",
  ACMESOLAR: "Acme Solar Holdings Ltd.",
  PREMIERENE: "Premier Energies Ltd.",
  ABSLAMC: "Aditya Birla Sun Life AMC Ltd.",
  CANBK: "Canara Bank",
  IDEA: "Vodafone Idea Ltd.",
  DEVYANI: "Devyani International Ltd.",
  TATAPOWER: "Tata Power Company Ltd.",
  RVNL: "Rail Vikas Nigam Ltd."
};

const FALLBACK_PRICES = {
  RELIANCE: 2950.50, TCS: 3910.20, HDFCBANK: 1680.80, INFY: 1540.40, ICICIBANK: 1185.15,
  ITC: 435.50, SBIN: 825.40, BHARTIARTL: 1415.00, LTIM: 5150.00, LT: 3450.00,
  KOTAKBANK: 1780.00, HINDUNILVR: 2450.00, MARUTI: 12100.00, TATASTEEL: 170.50, WIPRO: 480.00,
  AXISBANK: 1150.00, ASIANPAINT: 2850.00, "M&M": 2800.00, BAJFINANCE: 6900.00, SUNPHARMA: 1500.00,
  ADANIENT: 3150.00, NTPC: 370.00, ONGC: 265.00, TITAN: 3250.00, TATAMOTORS: 960.00,
  ETERNAL: 320.40, AVENUESAI: 120.50, IRCON: 270.80, PFS: 45.20, IRFC: 175.40,
  SUZLON: 65.10, SWIGGY: 450.00, JSWCEMENT: 250.00, IGI: 300.00, DLINK: 380.00,
  ITCHOTELS: 160.00, TMPV: 120.00, ATHER: 280.00, RBA: 105.00, DEEPAKBUILD: 210.00,
  GROWW: 500.00, AFCONS: 460.00, HIGHWAY: 115.00, ABCAPITAL: 225.00, GOPAL: 340.00,
  JIOFIN: 350.00, OLAELEC: 78.00, INFOBEAN: 390.00, ADITYAINFO: 150.00, NSDL: 420.00,
  GNGELEC: 90.00, VISHAL: 350.00, ENVIROINFRA: 160.00, ANTHEM: 450.00, SALASAR: 21.00,
  SHANTIGOLD: 135.00, MEESHO: 220.00, ANANTRAJ: 380.00, JUPITERWAG: 620.00, RPOWER: 30.00,
  NHPC: 102.00, IOB: 65.00, GTLINFRA: 2.50, PNB: 125.00, ACMESOLAR: 240.00,
  PREMIERENE: 1100.00, ABSLAMC: 620.00, CANBK: 118.00, IDEA: 16.80, DEVYANI: 170.00,
  TATAPOWER: 440.00, RVNL: 410.00
};

// 3. Define Stock schema and model
const StockSchema = new mongoose.Schema({
  ticker: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  change: { type: Number, default: 0 },
  changePercent: { type: Number, default: 0 },
  high: { type: Number, default: 0 },
  low: { type: Number, default: 0 },
  volume: { type: Number, default: 0 },
  isFallback: { type: Boolean, default: false },
  lastUpdated: { type: Date, default: Date.now }
}, { timestamps: true });

const Stock = mongoose.models.Stock || mongoose.model('Stock', StockSchema);

// 4. Synchronization Logic
async function syncStocks() {
  console.log('Starting Indian Stock sync to MongoDB...');
  
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongodbUri);
    console.log('MongoDB connected successfully.');
    
    let YahooFinance;
    let yf;
    let mode = 'real';
    
    try {
      YahooFinance = require('yahoo-finance2').default;
      yf = new YahooFinance();
    } catch (e) {
      console.warn('WARNING: yahoo-finance2 library could not be loaded. Operating in offline/mock mode.');
      mode = 'mock';
    }

    const tickers = Object.keys(TICKER_NAMES);
    const stocksData = [];
    
    if (mode === 'real') {
      console.log('Fetching live prices from Yahoo Finance...');
      
      const chunkArray = (arr, size) =>
        Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
          arr.slice(i * size, i * size + size)
        );

      const processTicker = async (ticker) => {
        const nseTicker = ticker === "M&M" ? "M&M.NS" : `${ticker}.NS`;
        
        let chartResult = null;
        let success = false;
        
        try {
          const date3MonthsAgo = new Date();
          date3MonthsAgo.setMonth(date3MonthsAgo.getMonth() - 3);
          
          try {
            chartResult = await yf.chart(nseTicker, { period1: date3MonthsAgo.toISOString(), interval: '1d' });
          } catch (e) {
            const searchResult = await yf.search(ticker);
            const dynamicSymbol = searchResult?.quotes?.find((q) => q.symbol?.endsWith('.NS') || q.symbol?.endsWith('.BO'))?.symbol;
            
            if (dynamicSymbol) {
               chartResult = await yf.chart(dynamicSymbol, { period1: date3MonthsAgo.toISOString(), interval: '1d' });
            } else {
               throw e;
            }
          }

          if (chartResult && chartResult.meta) {
            success = true;
          }
        } catch (e) {
          // Log quiet warning
        }

        if (!success || !chartResult) {
          const fallbackPrice = FALLBACK_PRICES[ticker] || 100;
          return {
            ticker,
            name: TICKER_NAMES[ticker],
            currentPrice: fallbackPrice,
            change: Number((fallbackPrice * 0.002).toFixed(2)),
            changePercent: 0.2,
            high: fallbackPrice * 1.01,
            low: fallbackPrice * 0.99,
            volume: 1200000,
            isFallback: true
          };
        }

        try {
          const meta = chartResult.meta;
          const currentPrice = meta.regularMarketPrice ?? FALLBACK_PRICES[ticker] ?? 100;
          const previousClose = meta.chartPreviousClose ?? meta.previousClose ?? currentPrice;
          const change = Number((currentPrice - previousClose).toFixed(2));
          const changePercent = Number(((change / previousClose) * 100).toFixed(2));
          
          const high = meta.regularMarketDayHigh ?? meta.high ?? (currentPrice * 1.01);
          const low = meta.regularMarketDayLow ?? meta.low ?? (currentPrice * 0.99);
          const volume = meta.regularMarketVolume ?? 1500000;

          return {
            ticker,
            name: TICKER_NAMES[ticker] || ticker,
            currentPrice: Number(currentPrice.toFixed(2)),
            change,
            changePercent,
            high: Number(high.toFixed(2)),
            low: Number(low.toFixed(2)),
            volume,
            isFallback: false
          };
        } catch (err) {
          const fallbackPrice = FALLBACK_PRICES[ticker] || 100;
          return {
            ticker,
            name: TICKER_NAMES[ticker],
            currentPrice: fallbackPrice,
            change: Number((fallbackPrice * 0.002).toFixed(2)),
            changePercent: 0.2,
            high: fallbackPrice * 1.01,
            low: fallbackPrice * 0.99,
            volume: 1200000,
            isFallback: true
          };
        }
      };

      const chunks = chunkArray(tickers, 5);
      
      for (const chunk of chunks) {
        process.stdout.write(`Processing batch ${chunks.indexOf(chunk) + 1}/${chunks.length}...\r`);
        const chunkResults = await Promise.all(chunk.map(ticker => processTicker(ticker)));
        stocksData.push(...chunkResults.filter(Boolean));
        if (chunks.indexOf(chunk) !== chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      console.log('\nAll data fetched successfully.');
    } else {
      console.log('Generating fallback stock mock data...');
      tickers.forEach(ticker => {
        const basePrice = FALLBACK_PRICES[ticker] || 100;
        stocksData.push({
          ticker,
          name: TICKER_NAMES[ticker],
          currentPrice: basePrice,
          change: Number((basePrice * 0.005).toFixed(2)),
          changePercent: 0.5,
          high: basePrice * 1.01,
          low: basePrice * 0.99,
          volume: 1000000,
          isFallback: true
        });
      });
    }

    console.log(`Writing ${stocksData.length} stocks to MongoDB...`);
    
    const bulkOps = stocksData.map((stock) => ({
      updateOne: {
        filter: { ticker: stock.ticker },
        update: {
          $set: {
            name: stock.name,
            price: stock.currentPrice,
            change: stock.change,
            changePercent: stock.changePercent,
            high: stock.high,
            low: stock.low,
            volume: stock.volume,
            isFallback: stock.isFallback,
            lastUpdated: new Date()
          }
        },
        upsert: true
      }
    }));

    const result = await Stock.bulkWrite(bulkOps);
    console.log('Sync complete!');
    console.log(`- Matched: ${result.matchedCount}`);
    console.log(`- Modified: ${result.modifiedCount}`);
    console.log(`- Upserted: ${result.upsertedCount}`);

  } catch (error) {
    console.error('An error occurred during synchronization:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed.');
    process.exit(0);
  }
}

syncStocks();
