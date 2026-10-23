import mongoose, { Schema, Document } from 'mongoose';

export interface IManagementGovernance extends Document {
  ticker: string;
  [key: string]: any;
}

const ManagementGovernanceSchema = new Schema(
  {
    ticker: { type: String, required: true, unique: true, index: true },
  },
  { strict: false, timestamps: true }
);

export default mongoose.models.ManagementGovernance ||
  mongoose.model<IManagementGovernance>('ManagementGovernance', ManagementGovernanceSchema, 'governance');
