import mongoose from 'mongoose';

const StockSchema = new mongoose.Schema({
  ticker: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: true,
  },
  change: {
    type: Number,
    default: 0,
  },
  changePercent: {
    type: Number,
    default: 0,
  },
  high: {
    type: Number,
    default: 0,
  },
  low: {
    type: Number,
    default: 0,
  },
  volume: {
    type: Number,
    default: 0,
  },
  marketCap: {
    type: Number,
    default: null,
  },
  sector: {
    type: String,
    default: 'Other',
  },
  isFallback: {
    type: Boolean,
    default: false,
  },
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
  providerSymbol: String,
  currency: String,
  quoteAsOf: String,
  fetchedAt: String,
  sessionStart: String,
  sessionEnd: String,
  dataSource: String,
  quoteStatus: String,
}, { timestamps: true });

export default mongoose.models.Stock || mongoose.model('Stock', StockSchema);
