import mongoose, { Schema, Document } from 'mongoose';

export interface IESGSustainability extends Document {
  ticker: string;
  [key: string]: any;
}

const ESGSustainabilitySchema = new Schema(
  {
    ticker: { type: String, required: true, unique: true, index: true },
  },
  { strict: false, timestamps: true }
);

export default mongoose.models.ESGSustainability ||
  mongoose.model<IESGSustainability>('ESGSustainability', ESGSustainabilitySchema, 'esgsustainability');
