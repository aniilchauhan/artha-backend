import mongoose, { Schema, Document } from 'mongoose';

export interface INewsEventsEarnings extends Document {
  ticker: string;
  [key: string]: any;
}

const NewsEventsEarningsSchema = new Schema(
  {
    ticker: { type: String, required: true, index: true },
  },
  { strict: false, timestamps: true }
);

export default mongoose.models.NewsEventsEarnings ||
  mongoose.model<INewsEventsEarnings>('NewsEventsEarnings', NewsEventsEarningsSchema, 'newseventscalls');
