import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  owner: { type: String, required: true, immutable: true },
  ticker: { type: String, required: true, immutable: true },
  name: { type: String, required: true, immutable: true },
  horizon: { type: String, enum: ['today', 'next'], required: true, immutable: true },
  recordedAt: { type: Date, required: true, immutable: true },
  quoteAsOf: { type: String, required: true, immutable: true },
  inputDate: { type: String, immutable: true },
  modelVersion: { type: String, required: true, immutable: true },
  policyVersion: { type: String, required: true, immutable: true },
  reference: { type: Number, required: true, immutable: true },
  target: { type: Number, required: true, immutable: true },
  estimate: { type: Number, default: null, immutable: true },
  evidenceCount: { type: Number, required: true, immutable: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  outcome: { type: mongoose.Schema.Types.Mixed, required: true },
  lastCheckedAt: { type: Date, default: null },
}, { versionKey: false, bufferCommands: false });
schema.index({ owner: 1, recordedAt: -1 });
schema.index({ owner: 1, 'outcome.status': 1, lastCheckedAt: 1 });

export default mongoose.models.ForwardPredictionHistory || mongoose.model('ForwardPredictionHistory', schema);
