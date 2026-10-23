import mongoose, { Schema, Document } from 'mongoose';

export interface ICompetitorIntelligence extends Document {
  ticker: string;
  [key: string]: any;
}

const CompetitorIntelligenceSchema = new Schema(
  {
    ticker: { type: String, required: true, unique: true, index: true },
  },
  { strict: false, timestamps: true }
);

export default mongoose.models.CompetitorIntelligence ||
  mongoose.model<ICompetitorIntelligence>('CompetitorIntelligence', CompetitorIntelligenceSchema, 'competitorintelligence');
