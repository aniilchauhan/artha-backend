import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyRequestOrigin } from '../../../../lib/auth-guard';
import { consumeFrameworkQuota } from '../../../../lib/framework-report-service';
import { fetchFrameworkHistory } from '../../../../lib/framework-market-data';
import { buildIpoOutlook, parseIpoOutlookRequest } from '../../../../lib/ipo-outlook';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (!verifyRequestOrigin(req)) return reply({ success: false, error: 'Invalid request origin.' }, 403);
  const auth = await requireAuth(req);
  if (!auth.authenticated) return auth.response;
  let input;
  try {
    const text = await req.text();
    if (text.length > 2048) return reply({ success: false, error: 'Request is too large.' }, 413);
    input = parseIpoOutlookRequest(JSON.parse(text));
  } catch (error) {
    return reply({ success: false, error: error instanceof SyntaxError ? 'Invalid JSON request.' : (error as Error).message }, 400);
  }
  if (!consumeFrameworkQuota(`ipo-outlook:${auth.session.user.email.toLowerCase()}`)) {
    return reply({ success: false, error: 'Request limit reached. Try again in one minute.' }, 429);
  }
  try {
    const results = await Promise.allSettled([fetchFrameworkHistory(`${input.ticker}.NS`), fetchFrameworkHistory('^NSEI')]);
    const data = buildIpoOutlook(input,
      results[0].status === 'fulfilled' ? results[0].value : null,
      results[1].status === 'fulfilled' ? results[1].value : null);
    return reply({ success: true, data });
  } catch {
    return reply({ success: false, error: 'IPO analysis is unavailable. Please try again shortly.' }, 503);
  }
}
