// Explicit single-owner mode supports local use when MongoDB is unavailable.
// Its limits belong to one server process. Hosted replicas should use MongoDB.
const attempts = new Map<string, { count: number; expires: number }>();

export function personalAccessEnabled(): boolean {
  return process.env.AXION_PERSONAL_MODE === 'true' &&
    !!process.env.AXION_PERSONAL_EMAIL && !!process.env.AXION_PERSONAL_PASSWORD_HASH;
}

export function consumePersonalQuota(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  for (const [id, bucket] of attempts) if (bucket.expires <= now) attempts.delete(id);
  const bucket = attempts.get(key) || { count: 0, expires: now + windowMs };
  bucket.count++;
  attempts.set(key, bucket);
  return bucket.count <= limit;
}
