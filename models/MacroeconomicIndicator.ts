import mongoose, { Schema, Document } from 'mongoose';

export interface IMacroeconomicIndicator extends Document {
  ticker: string;
  [key: string]: any;
}

const MacroeconomicIndicatorSchema = new Schema(
  {
    ticker: { type: String, required: true, unique: true, index: true },
  },
  { strict: false, timestamps: true }
);

export default mongoose.models.MacroeconomicIndicator ||
  mongoose.model<IMacroeconomicIndicator>('MacroeconomicIndicator', MacroeconomicIndicatorSchema, 'macroindicators');
