import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/axion_stocks';

const SmallCapStockSchema = new mongoose.Schema(
  {
    ticker: { type: String, required: true, unique: true, index: true },
    providerSymbol: { type: String, index: true },
    name: { type: String, required: true },
    currentPrice: { type: Number, required: true },
    previousClose: { type: Number, default: 0 },
    change: { type: Number, default: 0 },
    changePercent: { type: Number, default: 0 },
    high: { type: Number, default: 0 },
    low: { type: Number, default: 0 },
    volume: { type: Number, default: 0, index: true },
    marketCap: { type: Number, default: 0, index: true },
    marketCapTier: { type: String, enum: ['SMALL_CAP', 'MICRO_CAP', 'MID_CAP'], default: 'SMALL_CAP', index: true },
    averageVolume: { type: Number, default: 0 },
    exchange: { type: String, default: 'NSE' },
    series: { type: String, default: 'EQ' },
    quoteAsOf: { type: String, default: () => new Date().toISOString() },
    history: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true }
);

const SmallCapStock =
  mongoose.models.SmallCapStock ||
  mongoose.model('SmallCapStock', SmallCapStockSchema);

async function main() {
  console.log(`Connecting to MongoDB at ${MONGODB_URI}...`);
  await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });
  console.log('✓ Connected to MongoDB.\n');

  const filePath = path.join(projectRoot, 'data', 'backend-snapshots', 'small-cap-predictions.json');
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  console.log(`Reading small-cap-predictions.json (~23.9 MB)...`);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  const stocks = parsed?.data?.stocks || [];

  console.log(`Found ${stocks.length} small-cap equities to ingest into MongoDB...`);

  const BATCH_SIZE = 500;
  let ingested = 0;

  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    const chunk = stocks.slice(i, i + BATCH_SIZE);
    const bulkOps = chunk.map(s => {
      const mcap = s.marketCap || 0;
      const tier = mcap > 0 && mcap < 1000 ? 'MICRO_CAP' : 'SMALL_CAP';

      return {
        updateOne: {
          filter: { ticker: s.ticker },
          update: {
            $set: {
              ticker: s.ticker,
              providerSymbol: s.providerSymbol || `${s.ticker}.NS`,
              name: s.name || s.ticker,
              currentPrice: s.currentPrice || 0,
              previousClose: s.previousClose || 0,
              change: s.change || 0,
              changePercent: s.changePercent || 0,
              high: s.high || 0,
              low: s.low || 0,
              volume: s.volume || 0,
              marketCap: mcap,
              marketCapTier: tier,
              averageVolume: s.averageVolume || 0,
              exchange: s.exchange || 'NSE',
              series: s.series || 'EQ',
              quoteAsOf: s.quoteAsOf || new Date().toISOString(),
              history: Array.isArray(s.history) ? s.history : [],
            },
          },
          upsert: true,
        },
      };
    });

    await SmallCapStock.bulkWrite(bulkOps);
    ingested += chunk.length;
    console.log(`  Ingested ${ingested} / ${stocks.length} small cap equities...`);
  }

  const count = await SmallCapStock.countDocuments();
  console.log(`\n🎉 Success! Total small cap stocks in MongoDB 'smallcaps' collection: ${count}`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
