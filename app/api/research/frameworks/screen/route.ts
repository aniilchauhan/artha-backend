import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyRequestOrigin } from '../../../../../lib/auth-guard';
import { FRAMEWORK_REPORTS_ENABLED } from '../../../../../lib/framework-feature';
import { consumeFrameworkQuota } from '../../../../../lib/framework-report-service';
import { researchOwnerId } from '../../../../../lib/research-history-service';
import { parseFrameworkScreen, screenFrameworks } from '../../../../../lib/framework-screen';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 90;
const respond = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: NextRequest) {
  if (!FRAMEWORK_REPORTS_ENABLED) return respond({ success: false, error: 'Framework reports are disabled.' }, 404);
  if (!verifyRequestOrigin(request)) return respond({ success: false, error: 'Invalid request origin.' }, 403);
  const auth = await requireAuth(request);
  if (!auth.authenticated) return auth.response;
  let owner: string;
  try { owner = researchOwnerId(auth.session.user); } catch { return respond({ success: false, error: 'Sign in again.' }, 401); }
  if (!consumeFrameworkQuota(owner)) return respond({ success: false, error: 'Report limit reached. Try again in one minute.' }, 429);
  let input: ReturnType<typeof parseFrameworkScreen>;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return respond({ success: false, error: 'Request is too large.' }, 413);
    input = parseFrameworkScreen(JSON.parse(raw));
  } catch { return respond({ success: false, error: 'Supply 1–10 unique NSE tickers and supported strategies.' }, 400); }
  try { return respond({ success: true, data: await screenFrameworks(input) }); }
  catch { return respond({ success: false, error: 'Screening is temporarily unavailable.' }, 503); }
}
