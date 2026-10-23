import mongoose, { Schema, Document } from 'mongoose';

export interface IBusinessSegment extends Document {
  ticker: string;
  [key: string]: any;
}

const BusinessSegmentSchema = new Schema(
  {
    ticker: { type: String, required: true, unique: true, index: true },
  },
  { strict: false, timestamps: true }
);

export default mongoose.models.BusinessSegment ||
  mongoose.model<IBusinessSegment>('BusinessSegment', BusinessSegmentSchema, 'businesssegments');
