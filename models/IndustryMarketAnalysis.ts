import mongoose, { Schema, Document } from 'mongoose';

export interface IIndustryMarketAnalysis extends Document {
  ticker: string;
  [key: string]: any;
}

const IndustryMarketAnalysisSchema = new Schema(
  {
    ticker: { type: String, required: true, unique: true, index: true },
  },
  { strict: false, timestamps: true }
);

export default mongoose.models.IndustryMarketAnalysis ||
  mongoose.model<IIndustryMarketAnalysis>('IndustryMarketAnalysis', IndustryMarketAnalysisSchema, 'industryanalyses');
