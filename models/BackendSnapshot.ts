import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IBackendSnapshot extends Document {
  job: string;
  version: number;
  generatedAt: string;
  marketDataAsOf?: string | null;
  coverage?: {
    evaluated: number;
    total: number;
  };
  data: any;
  state?: string;
  updatedAt: Date;
}

const BackendSnapshotSchema = new Schema<IBackendSnapshot>(
  {
    job: { type: String, required: true, unique: true, index: true },
    version: { type: Number, default: 1 },
    generatedAt: { type: String, required: true },
    marketDataAsOf: { type: String, default: null },
    coverage: {
      evaluated: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },
    data: { type: Schema.Types.Mixed, required: true },
    state: { type: String, default: 'ready' },
  },
  { timestamps: true }
);

const BackendSnapshot: Model<IBackendSnapshot> =
  mongoose.models.BackendSnapshot ||
  mongoose.model<IBackendSnapshot>('BackendSnapshot', BackendSnapshotSchema);

export default BackendSnapshot;
