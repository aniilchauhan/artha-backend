import mongoose, { Schema, Document } from 'mongoose';

export interface IFinancialStatement extends Document {
  ticker: string;
  period: 'Annual' | 'Quarterly';
  periodValue: string;
  [key: string]: any;
}

const FinancialStatementSchema = new Schema(
  {
    ticker: { type: String, required: true, index: true },
    period: { type: String, required: true, enum: ['Annual', 'Quarterly'] },
    periodValue: { type: String, required: true }
  },
  { strict: false, timestamps: true }
);

FinancialStatementSchema.index({ ticker: 1, period: 1, periodValue: -1 }, { unique: true });

export default mongoose.models.FinancialStatement ||
  mongoose.model<IFinancialStatement>('FinancialStatement', FinancialStatementSchema, 'financialstatements');
