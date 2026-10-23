import mongoose, { Schema, Document } from 'mongoose';

export interface IProductIntelligence extends Document {
  ticker: string;
  [key: string]: any;
}

const ProductIntelligenceSchema = new Schema(
  {
    ticker: { type: String, required: true, unique: true, index: true },
  },
  { strict: false, timestamps: true }
);

export default mongoose.models.ProductIntelligence ||
  mongoose.model<IProductIntelligence>('ProductIntelligence', ProductIntelligenceSchema, 'products');
