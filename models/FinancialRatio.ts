import mongoose, { Schema, Document } from 'mongoose';

export interface IFinancialRatio extends Document {
  ticker: string;
  period: 'Annual' | 'Quarterly';
  periodValue: string;
  [key: string]: any;
}

const FinancialRatioSchema = new Schema(
  {
    ticker: { type: String, required: true, index: true },
    period: { type: String, required: true, enum: ['Annual', 'Quarterly'] },
    periodValue: { type: String, required: true }
  },
  { strict: false, timestamps: true }
);

FinancialRatioSchema.index({ ticker: 1, period: 1, periodValue: -1 }, { unique: true });

export default mongoose.models.FinancialRatio ||
  mongoose.model<IFinancialRatio>('FinancialRatio', FinancialRatioSchema, 'ratios');
