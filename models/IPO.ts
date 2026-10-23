import mongoose, { Schema, Document } from 'mongoose';

export interface IIPO extends Document {
  ticker?: string;
  companyName: string;
  issueSize: number; // in ₹ Crores
  priceBand: string;
  minBidQuantity: number;
  openDate: Date;
  closeDate: Date;
  listingDate: Date;
  status: 'upcoming' | 'active' | 'closed' | 'listed';
  gmp?: number; // Grey Market Premium
  subscriptionRate?: number;
  listingPrice?: number;
  listingGainPercent?: number;
  createdAt: Date;
  updatedAt: Date;
}

const IPOSchema = new Schema<IIPO>(
  {
    ticker: { type: String, uppercase: true, trim: true, index: true },
    companyName: { type: String, required: true, trim: true },
    issueSize: { type: Number, required: true }, // ₹ Cr
    priceBand: { type: String, required: true }, // e.g. "₹450 - ₹475"
    minBidQuantity: { type: Number, default: 15 },
    openDate: { type: Date, required: true },
    closeDate: { type: Date, required: true },
    listingDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ['upcoming', 'active', 'closed', 'listed'],
      required: true,
      index: true
    },
    gmp: { type: Number, default: 0 },
    subscriptionRate: { type: Number, default: 0 },
    listingPrice: { type: Number },
    listingGainPercent: { type: Number }
  },
  { timestamps: true }
);

export default mongoose.models.IPO || mongoose.model<IIPO>('IPO', IPOSchema);
