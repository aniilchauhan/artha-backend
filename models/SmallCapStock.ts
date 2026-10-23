import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ISmallCapStock extends Document {
  ticker: string;
  providerSymbol: string;
  name: string;
  currentPrice: number;
  previousClose: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
  marketCap: number;
  marketCapTier?: 'SMALL_CAP' | 'MICRO_CAP' | 'MID_CAP';
  averageVolume?: number;
  exchange: string;
  series: string;
  quoteAsOf: string;
  history?: Array<{
    date: string;
    price: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

const SmallCapStockSchema = new Schema<ISmallCapStock>(
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
    history: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true }
);

const SmallCapStock: Model<ISmallCapStock> =
  mongoose.models.SmallCapStock ||
  mongoose.model<ISmallCapStock>('SmallCapStock', SmallCapStockSchema);

export default SmallCapStock;
