import mongoose, { Schema, Document } from 'mongoose';

export interface ICustomerIntelligence extends Document {
  ticker: string;
  [key: string]: any;
}

const CustomerIntelligenceSchema = new Schema(
  {
    ticker: { type: String, required: true, unique: true, index: true },
  },
  { strict: false, timestamps: true }
);

export default mongoose.models.CustomerIntelligence ||
  mongoose.model<ICustomerIntelligence>('CustomerIntelligence', CustomerIntelligenceSchema, 'customers');
