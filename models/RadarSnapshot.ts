import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IRadarSnapshot extends Document {
  cycleId: string;
  timestamp: string;
  intervalMinutes: number;
  topPick?: any;
  twoPercentCandidate?: any;
  tenPercentCandidate?: any;
  activeSpikes: any[];
  recentHistory: any[];
}

const RadarSnapshotSchema = new Schema<IRadarSnapshot>(
  {
    cycleId: { type: String, required: true, unique: true, index: true },
    timestamp: { type: String, required: true, index: true },
    intervalMinutes: { type: Number, default: 5 },
    topPick: { type: Schema.Types.Mixed },
    twoPercentCandidate: { type: Schema.Types.Mixed },
    tenPercentCandidate: { type: Schema.Types.Mixed },
    activeSpikes: [{ type: Schema.Types.Mixed }],
    recentHistory: [{ type: Schema.Types.Mixed }],
  },
  {
    timestamps: true,
    strict: false,
  }
);

RadarSnapshotSchema.index({ timestamp: -1 });

const RadarSnapshot: Model<IRadarSnapshot> =
  mongoose.models.RadarSnapshot ||
  mongoose.model<IRadarSnapshot>('RadarSnapshot', RadarSnapshotSchema);

export default RadarSnapshot;
