import mongoose, { Schema, Document } from 'mongoose';

export interface IShareholdingOwnership extends Document {
  ticker: string;
  quarter: string;
  [key: string]: any;
}

const ShareholdingOwnershipSchema = new Schema(
  {
    ticker: { type: String, required: true, index: true },
    quarter: { type: String, required: true }
  },
  { strict: false, timestamps: true }
);

ShareholdingOwnershipSchema.index({ ticker: 1, quarter: -1 }, { unique: true });

export default mongoose.models.ShareholdingOwnership ||
  mongoose.model<IShareholdingOwnership>('ShareholdingOwnership', ShareholdingOwnershipSchema, 'shareholdings');
