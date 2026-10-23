import mongoose from 'mongoose';

const CompanyResearchReportSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  ownerId: { type: String, required: true, immutable: true },
  ticker: { type: String, required: true, immutable: true },
  savedAt: { type: Date, required: true, immutable: true },
  generatedAt: { type: Date, required: true, immutable: true },
  roles: { type: [String], required: true, immutable: true },
  status: { type: String, enum: ['complete', 'partial'], required: true, immutable: true },
  summary: { type: String, required: true, immutable: true },
  report: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
}, { versionKey: false, bufferCommands: false });

CompanyResearchReportSchema.index({ ownerId: 1, ticker: 1, savedAt: -1, _id: -1 });

export default mongoose.models.CompanyResearchReport || mongoose.model('CompanyResearchReport', CompanyResearchReportSchema);
