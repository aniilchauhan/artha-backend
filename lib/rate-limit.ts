import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import connectToDatabase from './mongodb';
import RateLimit from '../models/RateLimit';
import { consumePersonalQuota, personalAccessEnabled } from './personal-access';

export interface RateLimitResponseOptions {
  retryAfterSeconds?: number;
  message?: string;
  code?: string;
}

export function rateLimitResponse(options: RateLimitResponseOptions = {}): NextResponse {
  const retryAfter = options.retryAfterSeconds ?? 60;
  const message = options.message || 'Rate limit exceeded. Please try again later.';
  const code = options.code || 'RATE_LIMIT_EXCEEDED';

  return NextResponse.json(
    {
      success: false,
      error: message,
      code,
      retryAfter,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfter),
        'X-RateLimit-Reset': String(Math.ceil(Date.now() / 1000) + retryAfter),
      },
    }
  );
}

// A time bucket in MongoDB's unique _id shares quotas across replicas and does
// not depend on the TTL cleanup worker running before a window can reset.
export async function consumeQuota(key: string, limit: number, windowMs: number, now = Date.now()): Promise<boolean> {
  try {
    await connectToDatabase();
  } catch (error) {
    if (personalAccessEnabled()) return consumePersonalQuota(key, limit, windowMs, now);
    throw error;
  }
  const window = Math.floor(now / windowMs);
  const id = `${createHash('sha256').update(key).digest('hex')}:${window}`;
  try {
    const bucket = await RateLimit.findOneAndUpdate({ _id: id }, {
      $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 2) * windowMs) },
    }, { upsert: true, new: true });
    return bucket.count <= limit;
  } catch (error: any) {
    // Concurrent first requests may race to insert this window's counter.
    if (error?.code !== 11000) throw error;
    const bucket = await RateLimit.findOneAndUpdate({ _id: id }, { $inc: { count: 1 } }, { new: true });
    return !!bucket && bucket.count <= limit;
  }
}
