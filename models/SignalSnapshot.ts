import mongoose, { Schema, Document, Model } from 'mongoose';
import type { DecisionSignal } from '../lib/signal-schema';

export interface ISignalSnapshotDoc extends Omit<Document, '_id'>, Omit<DecisionSignal, 'id'> {
  _id: string;
}

const SignalSnapshotSchema = new Schema<ISignalSnapshotDoc>(
  {
    _id: { type: String, required: true, immutable: true },
    deduplicationKey: { type: String, required: true, immutable: true, index: true },
    revision: { type: Number, required: true, immutable: true },
    parentSignalId: { type: String, default: null, immutable: true },
    strategyVersion: { type: String, required: true, immutable: true, index: true },
    signalType: {
      type: String,
      enum: ['ACTIONABLE_PAPER_SIGNAL', 'WATCHLIST_OBSERVATION'],
      required: true,
      immutable: true,
    },
    state: {
      type: String,
      enum: ['watching', 'entry_met', 'paper_open', 'review_due', 'invalidated', 'expired'],
      required: true,
    },
    instrumentId: { type: String, required: true, immutable: true, index: true },
    symbol: { type: String, required: true, immutable: true },
    companyName: { type: String, required: true, immutable: true },
    series: { type: String, required: true, immutable: true },
    dataCutoff: { type: String, required: true, immutable: true },
    issuedAt: { type: String, required: true, immutable: true, index: true },
    validUntil: { type: String, required: true, immutable: true },
    referencePrice: { type: Number, required: true, immutable: true },
    quoteSource: { type: String, required: true, immutable: true },
    quoteStatus: { type: String, required: true, immutable: true },
    metrics: { type: Schema.Types.Mixed, required: true, immutable: true },
    conditions: { type: Schema.Types.Mixed, required: true, immutable: true },
    sizing: { type: Schema.Types.Mixed, required: true, immutable: true },
    measuredReasons: [{ type: String }],
    evidenceMissing: [{ type: String }],
    companyHoldAssessment: { type: Schema.Types.Mixed, required: true },
    immutableHash: { type: String, required: true, immutable: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

SignalSnapshotSchema.index({ deduplicationKey: 1, revision: -1 });
SignalSnapshotSchema.index({ strategyVersion: 1, issuedAt: -1 });
SignalSnapshotSchema.index({ instrumentId: 1, issuedAt: -1 });

const SignalSnapshot: Model<ISignalSnapshotDoc> =
  mongoose.models.SignalSnapshot ||
  mongoose.model<ISignalSnapshotDoc>('SignalSnapshot', SignalSnapshotSchema);

export default SignalSnapshot;
