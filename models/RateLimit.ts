import mongoose from 'mongoose';

const RateLimitSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  count: { type: Number, required: true },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
}, { versionKey: false });

export default mongoose.models.RateLimit || mongoose.model('RateLimit', RateLimitSchema);
