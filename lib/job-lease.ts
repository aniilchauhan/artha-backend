import crypto from 'node:crypto';
import connectToDatabase from './mongodb';
import JobLease from '../models/JobLease';

export interface JobLeaseHandle {
  key: string;
  ownerId: string;
  operationId: string;
}

export async function acquireJobLease(key: string, ttlMs = 60000, ownerId = crypto.randomUUID()): Promise<JobLeaseHandle | null> {
  await connectToDatabase();
  await JobLease.init();
  const now = new Date();
  const operationId = crypto.randomUUID();

  try {
    const lease = await JobLease.findOneAndUpdate(
      { key, $or: [{ expiresAt: { $lte: now } }, { expiresAt: { $exists: false } }] },
      { $set: { ownerId, operationId, expiresAt: new Date(Date.now() + ttlMs) } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    if (!lease || lease.ownerId !== ownerId || lease.operationId !== operationId) return null;
    return { key, ownerId, operationId };
  } catch (error: any) {
    if (error?.code === 11000 || /duplicate key/i.test(error?.message || '')) {
      return null;
    }
    throw error;
  }
}

export async function renewJobLease(handle: JobLeaseHandle, ttlMs = 60000): Promise<boolean> {
  await connectToDatabase();
  const result = await JobLease.updateOne(
    { key: handle.key, ownerId: handle.ownerId, operationId: handle.operationId, expiresAt: { $gt: new Date() } },
    { $set: { expiresAt: new Date(Date.now() + ttlMs) } },
  );
  return result.modifiedCount === 1;
}

export async function releaseJobLease(handle: JobLeaseHandle): Promise<boolean> {
  await connectToDatabase();
  const result = await JobLease.deleteOne({ key: handle.key, ownerId: handle.ownerId, operationId: handle.operationId });
  return result.deletedCount === 1;
}