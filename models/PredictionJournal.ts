import mongoose from 'mongoose';

// Immutable inputs; only the separately recorded outcome/check time can change.
// _id is the first-review-per-stock/session/cohort key, enforced by Mongo itself.
const PredictionJournalSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  ticker: { type: String, required: true, immutable: true },
  recordedAt: { type: Date, required: true, immutable: true },
  assessment: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  policyVersion: { type: String, required: true, immutable: true },
  promptVersion: { type: String, required: true, immutable: true },
  outcome: { type: mongoose.Schema.Types.Mixed, required: true },
  lastCheckedAt: { type: Date, default: null },
}, { versionKey: false, bufferCommands: false });

PredictionJournalSchema.index({ recordedAt: -1 });
PredictionJournalSchema.index({ 'outcome.status': 1, lastCheckedAt: 1 });

export default mongoose.models.PredictionJournal || mongoose.model('PredictionJournal', PredictionJournalSchema);
