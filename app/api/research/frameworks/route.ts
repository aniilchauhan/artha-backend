import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyRequestOrigin } from '../../../../lib/auth-guard';
import { FRAMEWORK_REPORTS_ENABLED } from '../../../../lib/framework-feature';
import { frameworkResearchEnvelope, parseFrameworkRequest } from '../../../../lib/framework-report';
import { assessResearchHorizon } from '../../../../lib/horizon-assessment';
import { consumeFrameworkQuota, getFrameworkReport } from '../../../../lib/framework-report-service';
import { researchOwnerId, saveResearchReport } from '../../../../lib/research-history-service';
import { saveHorizonPrediction } from '../../../../lib/horizon-history';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
const respond = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: NextRequest) {
  if (!FRAMEWORK_REPORTS_ENABLED) return respond({ success: false, error: 'Framework reports are disabled.' }, 404);
  if (!verifyRequestOrigin(request)) return respond({ success: false, error: 'Invalid request origin.' }, 403);
  const auth = await requireAuth(request);
  if (!auth.authenticated) return auth.response;
  let owner: string;
  try { owner = researchOwnerId(auth.session.user); }
  catch { return respond({ success: false, error: 'Sign in again to establish your account identity.' }, 401); }
  if (!consumeFrameworkQuota(owner)) return respond({ success: false, error: 'Report limit reached. Try again in one minute.' }, 429);
  let parsed: ReturnType<typeof parseFrameworkRequest>;
  try {
    const raw = await request.text();
    if (raw.length > 4096) return respond({ success: false, error: 'Request is too large.' }, 413);
    parsed = parseFrameworkRequest(JSON.parse(raw));
  } catch (error) {
    return respond({ success: false, error: error instanceof SyntaxError ? 'A JSON request is required.'
      : error instanceof Error ? error.message : 'Invalid request.' }, 400);
  }
  try {
    const framework = await getFrameworkReport(parsed);
    framework.horizonAssessment = assessResearchHorizon(framework, parsed.horizon ?? 'week');
    const data = frameworkResearchEnvelope(framework);
    const [save, horizonSave] = await Promise.all([
      saveResearchReport(owner, data),
      saveHorizonPrediction(owner, parsed.ticker, framework.horizonAssessment),
    ]);
    return respond({ success: true, data, save, horizonSave });
  } catch {
    return respond({ success: false, error: 'Framework analysis is unavailable. Please retry.' }, 503);
  }
}
