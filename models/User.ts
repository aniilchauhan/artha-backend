import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
  },
  emailVerified: {
    type: Boolean,
    default: false,
  },
  emailVerificationTokenHash: {
    type: String,
    select: false,
  },
  emailVerificationExpiresAt: {
    type: Date,
    select: false,
  },
  watchlist: {
    type: [String],
    default: [],
  },
  signalWatchlist: {
    type: [String],
    default: [],
  },
  customTickers: {
    type: [String],
    default: [],
  },
  holdings: {
    type: Map,
    of: new mongoose.Schema({
      ticker: String,
      quantity: Number,
      buyPrice: Number,
    }, { _id: false }),
    default: {},
  },
  thresholds: {
    type: Map,
    of: Number,
    default: {},
  },
  portfolioTransactions: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  portfolioCash: {
    type: Number,
    default: 100000,
  },
  portfolioVersion: { type: Number, default: 0 },
  portfolioSaveReceipts: {
    type: [new mongoose.Schema({ operationId: String, digest: String, version: Number }, { _id: false })],
    default: [],
  },
  portfolioEquityHistory: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  portfolioRiskRules: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {},
  },
  savedFilters: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  watchlistGroups: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
}, { timestamps: true });

export default mongoose.models.User || mongoose.model('User', UserSchema);
