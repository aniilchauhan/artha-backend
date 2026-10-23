import mongoose, { Schema, Document } from 'mongoose';

export interface ISupplierIntelligence extends Document {
  ticker: string;
  [key: string]: any;
}

const SupplierIntelligenceSchema = new Schema(
  {
    ticker: { type: String, required: true, unique: true, index: true },
  },
  { strict: false, timestamps: true }
);

export default mongoose.models.SupplierIntelligence ||
  mongoose.model<ISupplierIntelligence>('SupplierIntelligence', SupplierIntelligenceSchema, 'suppliers');
