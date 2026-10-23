import mongoose, { Schema, Document } from 'mongoose';

export interface IPriceTechnicalData extends Document {
  ticker: string;
  date: Date;
  [key: string]: any;
}

const PriceTechnicalDataSchema = new Schema(
  {
    ticker: { type: String, required: true, index: true },
    date: { type: Date, required: true }
  },
  { strict: false, timestamps: true }
);

PriceTechnicalDataSchema.index({ ticker: 1, date: -1 }, { unique: true });

export default mongoose.models.PriceTechnicalData ||
  mongoose.model<IPriceTechnicalData>('PriceTechnicalData', PriceTechnicalDataSchema, 'pricetechnicaldata');
