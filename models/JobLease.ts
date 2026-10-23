import mongoose from 'mongoose';

const JobLeaseSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  ownerId: { type: String, required: true },
  operationId: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

export default mongoose.models.JobLease || mongoose.model('JobLease', JobLeaseSchema);