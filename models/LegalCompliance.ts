import mongoose, { Schema, Document } from 'mongoose';

export interface ILegalCompliance extends Document {
  ticker: string;
  [key: string]: any;
}

const LegalComplianceSchema = new Schema(
  {
    ticker: { type: String, required: true, unique: true, index: true },
  },
  { strict: false, timestamps: true }
);

export default mongoose.models.LegalCompliance ||
  mongoose.model<ILegalCompliance>('LegalCompliance', LegalComplianceSchema, 'legalcases');
