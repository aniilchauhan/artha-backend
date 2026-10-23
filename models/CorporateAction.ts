import mongoose, { Schema, Document } from 'mongoose';

export interface ICorporateAction extends Document {
  ticker: string;
  [key: string]: any;
}

const CorporateActionSchema = new Schema(
  {
    ticker: { type: String, required: true, index: true },
  },
  { strict: false, timestamps: true }
);

export default mongoose.models.CorporateAction ||
  mongoose.model<ICorporateAction>('CorporateAction', CorporateActionSchema, 'corporateactions');
