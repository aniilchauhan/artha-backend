import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ITradeRecord extends Document {
  symbol: string;
  sector: string;
  setupType: string;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  convictionScore: number;
  marketRegimeAtEntry: 'bull' | 'neutral' | 'bear';
  entryTimestamp: string;
  orderId?: string;
  mode?: 'paper' | 'angel_one';
  action?: 'BUY' | 'SELL';
  quantity?: number;
  executionPrice?: number;
  productType?: string;
  status?: string;
  notes?: string;
  exitPrice?: number;
  exitReason?: 'target_hit' | 'stop_hit' | 'manual_exit' | 'expired';
  holdingDays?: number;
  netReturnPct?: number;
}

const TradeRecordSchema = new Schema<ITradeRecord>({
  symbol:              { type: String, required: true, index: true },
  sector:              { type: String, default: 'General' },
  setupType:           { type: String, default: 'MOMENTUM_RADAR' },
  entryPrice:          { type: Number, required: true },
  stopPrice:           { type: Number, required: true },
  targetPrice:         { type: Number, required: true },
  convictionScore:     { type: Number, default: 0.85 },
  marketRegimeAtEntry: { type: String, enum: ['bull', 'neutral', 'bear'], default: 'bull' },
  entryTimestamp:      { type: String, required: true, index: true },
  orderId:             { type: String, index: true },
  mode:                { type: String, enum: ['paper', 'angel_one'], default: 'paper' },
  action:              { type: String, enum: ['BUY', 'SELL'], default: 'BUY' },
  quantity:            { type: Number, default: 1 },
  executionPrice:      { type: Number },
  productType:         { type: String, default: 'INTRADAY' },
  status:              { type: String, default: 'EXECUTED' },
  notes:               { type: String, default: '' },
  exitPrice:           { type: Number },
  exitReason:          { type: String, enum: ['target_hit', 'stop_hit', 'manual_exit', 'expired'] },
  holdingDays:         { type: Number },
  netReturnPct:        { type: Number },
}, { timestamps: true, strict: false });

const TradeRecord: Model<ITradeRecord> =
  mongoose.models.TradeRecord ||
  mongoose.model<ITradeRecord>('TradeRecord', TradeRecordSchema);

export default TradeRecord;
