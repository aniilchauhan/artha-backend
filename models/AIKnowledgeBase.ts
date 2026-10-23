import mongoose, { Schema, Document } from 'mongoose';

export interface IAIKnowledgeBase extends Document {
  ticker: string;
  [key: string]: any;
}

const AIKnowledgeBaseSchema = new Schema(
  {
    ticker: { type: String, required: true, unique: true, index: true },
  },
  { strict: false, timestamps: true }
);

export default mongoose.models.AIKnowledgeBase ||
  mongoose.model<IAIKnowledgeBase>('AIKnowledgeBase', AIKnowledgeBaseSchema, 'aiknowledgebases');
