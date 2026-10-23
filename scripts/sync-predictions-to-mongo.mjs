import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';

const envPath = path.resolve('.env.local');
let mongodbUri = process.env.MONGODB_URI;

if (!mongodbUri && fs.existsSync(envPath)) {
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

if (!mongodbUri) {
  console.error('ERROR: MONGODB_URI is not defined in .env.local');
  process.exit(1);
}

const predictionsPath = path.resolve('data/stock-ai/latest_predictions.json');
if (!fs.existsSync(predictionsPath)) {
  console.error('ERROR: latest_predictions.json not found');
  process.exit(1);
}

const rawData = JSON.parse(fs.readFileSync(predictionsPath, 'utf8'));
const predictions = Array.isArray(rawData) ? rawData : (rawData.data || []);

const PredictionSchema = new mongoose.Schema({
  date: { type: String, required: true, index: true },
  ticker: { type: String, required: true, index: true },
  rank: { type: Number },
  modelScore: { type: Number },
  label: { type: String },
  closePrice: { type: Number },
  tradeLevels: { type: mongoose.Schema.Types.Mixed },
  sector: { type: String },
  rsi: { type: Number },
  volumeRatio: { type: Number },
  atrPct: { type: String },
  raw: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true, strict: false });

PredictionSchema.index({ date: 1, ticker: 1 }, { unique: true });

const AIPrediction = mongoose.models.AIPrediction || mongoose.model('AIPrediction', PredictionSchema);

async function sync() {
  console.log(`Connecting to MongoDB at ${mongodbUri}...`);
  await mongoose.connect(mongodbUri, { serverSelectionTimeoutMS: 5000 });
  console.log(`Connected. Ingesting ${predictions.length} AI stock predictions...`);

  let count = 0;
  for (const p of predictions) {
    const date = p.Date || new Date().toISOString().split('T')[0];
    const ticker = (p.Ticker || '').toUpperCase();
    if (!ticker) continue;

    await AIPrediction.findOneAndUpdate(
      { date, ticker },
      {
        date,
        ticker,
        rank: p.Rank,
        modelScore: p['Model Score'],
        label: p.Label,
        closePrice: p.Close_Numeric,
        tradeLevels: p.trade_levels,
        sector: p.Sector,
        rsi: p['RSI (14)'],
        volumeRatio: p['Vol Ratio (20d)'],
        atrPct: p['ATR %'],
        raw: p,
      },
      { upsert: true, returnDocument: 'after' }
    );
    count++;
  }

  console.log(`Successfully synced ${count} AI predictions into MongoDB collection 'aipredictions'!`);
  await mongoose.disconnect();
}

sync().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
