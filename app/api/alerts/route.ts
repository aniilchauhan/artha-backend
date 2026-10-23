import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyRequestOrigin } from '../../../lib/auth-guard';
import {
  alertAccountKey,
  readAlerts,
  updateAlerts,
  setPriceAlert,
  updateAlertPreferences,
  workerStatus,
} from '../../../lib/alert-store';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.authenticated) return auth.response;
  try {
    return json({ success: true, ...await readAlerts(alertAccountKey(auth.session.user.email)), worker: await workerStatus() });
  } catch { return json({ success: false, error: 'Alert history is temporarily unavailable.' }, 503); }
}

export async function POST(req: NextRequest) {
  if (!verifyRequestOrigin(req)) return json({ success: false, error: 'Invalid request origin.' }, 403);
  const auth = await requireAuth(req);
  if (!auth.authenticated) return auth.response;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ success: false, error: 'Invalid alert request.' }, 400);
  const key = alertAccountKey(auth.session.user.email);
  try {
    let state;
    if (body.action === 'set') {
      if (typeof body.ticker !== 'string' || !/^[A-Z0-9&_-]{1,25}(\.(NS|BO))?$/.test(body.ticker) ||
          (body.threshold !== null && (typeof body.threshold !== 'number' || !Number.isFinite(body.threshold) || body.threshold <= 0 || body.threshold > 100_000_000))) {
        return json({ success: false, error: 'Enter a valid ticker and positive price.' }, 400);
      }
      const direction = (body.direction === 'above' || body.direction === 'below') ? body.direction : undefined;
      const label = typeof body.label === 'string' ? body.label.slice(0, 50) : undefined;
      const cooldownMinutes = typeof body.cooldownMinutes === 'number' && body.cooldownMinutes >= 0 && body.cooldownMinutes <= 1440 ? body.cooldownMinutes : undefined;
      const maxDailyTriggers = typeof body.maxDailyTriggers === 'number' && body.maxDailyTriggers >= 1 && body.maxDailyTriggers <= 100 ? body.maxDailyTriggers : undefined;
      const recurring = typeof body.recurring === 'boolean' ? body.recurring : undefined;

      state = await updateAlerts(key, current => setPriceAlert(current, body.ticker, body.threshold, {
        direction,
        label,
        cooldownMinutes,
        maxDailyTriggers,
        recurring,
      }));
    } else if (body.action === 'setPreferences') {
      if (!body.preferences || typeof body.preferences !== 'object' || Array.isArray(body.preferences)) {
        return json({ success: false, error: 'Invalid alert preferences format.' }, 400);
      }
      state = await updateAlerts(key, current => updateAlertPreferences(current, body.preferences));
    } else if (body.action === 'read' && Array.isArray(body.ids) && body.ids.length <= 100 && body.ids.every((id: unknown) => typeof id === 'string' && id.length <= 64)) {
      state = await updateAlerts(key, current => { for (const event of current.events) if (body.ids.includes(event.id)) event.read = true; });
    } else return json({ success: false, error: 'Invalid alert action.' }, 400);
    return json({ success: true, ...state, worker: await workerStatus() });
  } catch { return json({ success: false, error: 'Unable to save this alert. Existing alerts were preserved.' }, 503); }
}
