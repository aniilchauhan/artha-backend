import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  ownerId: { type: String, required: true, immutable: true },
  ticker: { type: String, required: true, immutable: true },
  horizon: { type: String, enum: ['week', 'month', 'year', 'multibagger'], required: true, immutable: true },
  recordedAt: { type: Date, required: true, immutable: true },
  inputSession: { type: String, required: true, immutable: true },
  referencePrice: { type: Number, required: true, immutable: true },
  benchmarkReferencePrice: { type: Number, immutable: true },
  ruleVersion: { type: String, required: true, immutable: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  outcome: { type: mongoose.Schema.Types.Mixed, required: true },
  lastCheckedAt: { type: Date, default: null },
}, { versionKey: false, bufferCommands: false });
schema.index({ ownerId: 1, recordedAt: -1 });
schema.index({ ownerId: 1, 'outcome.status': 1, lastCheckedAt: 1 });

export default mongoose.models.HorizonPrediction || mongoose.model('HorizonPrediction', schema);
