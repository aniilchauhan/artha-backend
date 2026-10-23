import mongoose, { Schema, Document } from 'mongoose';

export interface IAnalystValuationModel extends Document {
  ticker: string;
  [key: string]: any;
}

const AnalystValuationModelSchema = new Schema(
  {
    ticker: { type: String, required: true, unique: true, index: true },
  },
  { strict: false, timestamps: true }
);

export default mongoose.models.AnalystValuationModel ||
  mongoose.model<IAnalystValuationModel>('AnalystValuationModel', AnalystValuationModelSchema, 'valuationmodels');
