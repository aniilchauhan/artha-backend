import mongoose, { Schema, Document } from 'mongoose';

export interface IMasterCompanyProfile extends Document {
  ticker: string;
  [key: string]: any;
}

const MasterCompanyProfileSchema = new Schema(
  {
    ticker: { type: String, required: true, unique: true, index: true },
  },
  { strict: false, timestamps: true }
);

export default mongoose.models.MasterCompanyProfile ||
  mongoose.model<IMasterCompanyProfile>('MasterCompanyProfile', MasterCompanyProfileSchema, 'companyprofiles');
