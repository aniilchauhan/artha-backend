import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';

const envPath = path.resolve('.env.local');
let mongodbUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/axion_stocks';

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (key === 'MONGODB_URI') {
          mongodbUri = val.replace(/^["']|["']$/g, '');
        }
      }
    }
  }
}

const dataFile = path.resolve('data/all_indian_stocks_5055.json');
if (!fs.existsSync(dataFile)) {
  console.error(`Cannot find ${dataFile}`);
  process.exit(1);
}

const rawList = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
console.log(`Loaded ${rawList.length} Indian stocks from ${dataFile}`);

const StockSchema = new mongoose.Schema({
  ticker: { type: String, required: true, unique: true, index: true },
  symbol: { type: String, index: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  change: { type: Number, default: 0 },
  changePercent: { type: Number, default: 0 },
  high: { type: Number, default: 0 },
  low: { type: Number, default: 0 },
  volume: { type: Number, default: 0 },
  marketCap: { type: Number, default: 0 },
  sector: { type: String, default: 'Other' },
  exchange: { type: String, default: 'NSE/BSE' },
  rsi: { type: Number },
  atr: { type: String },
  sentiment: { type: String },
  sparkline: [Number],
  tradeLevels: { type: mongoose.Schema.Types.Mixed },
  isFallback: { type: Boolean, default: false },
  lastUpdated: { type: Date, default: Date.now },
}, { timestamps: true, strict: false });

const Stock = mongoose.models.Stock || mongoose.model('Stock', StockSchema);

async function main() {
  console.log(`Connecting to MongoDB at: ${mongodbUri}...`);
  await mongoose.connect(mongodbUri, { serverSelectionTimeoutMS: 5000 });
  console.log('MongoDB connected successfully.');

  const BATCH_SIZE = 500;
  let totalProcessed = 0;

  for (let i = 0; i < rawList.length; i += BATCH_SIZE) {
    const batch = rawList.slice(i, i + BATCH_SIZE);
    const bulkOps = batch.map((item) => {
      const cleanTicker = item.ticker || `${item.symbol}.NS`;
      const cleanSymbol = item.symbol || cleanTicker.replace(/\.NS$/, '').replace(/\.BO$/, '');
      const price = Number(item.price || item.currentPrice || 0);

      return {
        updateOne: {
          filter: { ticker: cleanTicker },
          update: {
            $set: {
              ticker: cleanTicker,
              symbol: cleanSymbol,
              name: item.name || cleanSymbol,
              price: price,
              currentPrice: price,
              change: Number(item.change || 0),
              changePercent: Number(item.changePercent || 0),
              sector: item.sector || 'Other',
              marketCap: Number(item.marketCap || 0),
              exchange: item.exchange || 'NSE/BSE',
              rsi: item.rsi,
              atr: item.atr,
              sentiment: item.sentiment,
              sparkline: item.sparkline || [],
              tradeLevels: item.tradeLevels,
              lastUpdated: new Date(),
            },
          },
          upsert: true,
        },
      };
    });

    await Stock.bulkWrite(bulkOps, { ordered: false });
    totalProcessed += batch.length;
    console.log(`  Processed ${totalProcessed} / ${rawList.length} stocks...`);
  }

  const finalCount = await Stock.countDocuments();
  console.log(`\n🎉 Successfully ingested full Indian universe into MongoDB!`);
  console.log(`Total stocks in MongoDB 'stocks' collection: ${finalCount}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
