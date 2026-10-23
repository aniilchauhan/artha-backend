import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyRequestOrigin } from './auth-guard';
import { consumeQuota, rateLimitResponse } from './rate-limit';

export function consumeAiQuota(key: string, now = Date.now()): Promise<boolean> {
  return consumeQuota(`ai:${key}`, 10, 60_000, now);
}

export async function guardAiRequest(req: NextRequest): Promise<NextResponse | null> {
  if (!verifyRequestOrigin(req)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  }
  const auth = await requireAuth(req);
  if (!auth.authenticated) return auth.response;
  try {
    if (!await consumeAiQuota(auth.session.user.email.toLowerCase())) {
      return rateLimitResponse({
        retryAfterSeconds: 60,
        message: 'AI request limit reached. Try again in one minute.',
      });
    }
  } catch {
    return NextResponse.json({ error: 'Request limits are temporarily unavailable. Try again later.' }, { status: 503 });
  }
  return null;
}
