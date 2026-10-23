import mongoose, { Schema, Document } from 'mongoose';

export interface IManufacturingOperations extends Document {
  ticker: string;
  [key: string]: any;
}

const ManufacturingOperationsSchema = new Schema(
  {
    ticker: { type: String, required: true, unique: true, index: true },
  },
  { strict: false, timestamps: true }
);

export default mongoose.models.ManufacturingOperations ||
  mongoose.model<IManufacturingOperations>('ManufacturingOperations', ManufacturingOperationsSchema, 'operations');
