import { NextRequest, NextResponse } from 'next/server';
import { currentShare } from '../../../lib/forward-quote';
import { getLatestPredictions } from '../../../lib/stock-ai-service';
import { getArtifactProvenance } from '../../../lib/artifact-provenance';
import { indiaDate, nextOpportunity } from '../../../lib/opportunity-analysis';
import { loadUniverseStockRecords } from '../../../lib/universe-engine';
import { guardAiRequest } from '../../../lib/ai-request-guard';
import { requireAuth } from '../../../lib/auth-guard';
import { saveForwardHistory } from '../../../lib/forward-history-service';
import type { ShareOpportunity } from '../../../lib/opportunity-types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function run(request: NextRequest, owner?: string) {
  const horizon = request.nextUrl.searchParams.get('horizon') || 'today';
  const checkedAt = new Date();
  const respond = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  const finish = async (body: { data: ShareOpportunity[]; [key: string]: unknown }, modelVersion: string) => {
    const history = owner ? await saveForwardHistory(owner, body.data, horizon as 'today' | 'next', modelVersion)
      : { status: 'signin_required', saved: 0, message: 'Sign in before scanning to save observations for outcome history.' };
    return respond({ ...body, history });
  };
  if (!['today', 'next'].includes(horizon)) return respond({ error: 'Invalid horizon.' }, 400);
  try {
    if (horizon === 'next') {
      const provenance = getArtifactProvenance('latest_predictions.json');
      const rows = getLatestPredictions();
      const today = indiaDate(checkedAt);
      const close = Date.parse(`${today}T15:30:00+05:30`);
      const generated = Date.parse(provenance.generatedAt || '');
      // Require a completed, dated session; never relabel yesterday's forecast as tomorrow's.
      if (provenance.status !== 'verified' || !rows.length || rows.some(p => p.Date !== today) ||
          checkedAt.getTime() < close || !Number.isFinite(generated) || generated < close || generated > checkedAt.getTime()) {
        return respond({ checkedAt: checkedAt.toISOString(), data: [], message: 'Next-session predictions require a verified model run after today’s 15:30 IST close. No current forward report is available yet.' });
      }
      const data = rows.filter(p => p['Model Score'] >= 0.5).map(p => nextOpportunity(p, checkedAt))
        .filter(p => p !== null).sort((a, b) => (b.estimate ?? 0) - (a.estimate ?? 0));
      for (const item of data) item.summary = 'Model candidate for the session after the saved input date. The score estimates the next-open +2% event; live forward accuracy has not been established here.';
      return finish({ checkedAt: checkedAt.toISOString(), generatedAt: provenance.generatedAt, data,
        message: 'Next trading session model candidates. Probability refers to the model’s next-open +2% event, not a gain from your current quote. Targets shown are reference scenarios.' }, `next-open-v2:${provenance.modelSha256 || 'unidentified'}`);
    }
    const today = indiaDate(checkedAt);
    if (checkedAt.getTime() < Date.parse(`${today}T09:15:00+05:30`) || checkedAt.getTime() >= Date.parse(`${today}T15:30:00+05:30`)) {
      return respond({ checkedAt: checkedAt.toISOString(), data: [], message: 'After-now setups are available during the regular session, 09:15–15:30 IST, using fresh same-session quotes.' });
    }
    const tickers = [...new Set(loadUniverseStockRecords().filter(r => r.series === 'EQ').map(r => r.ticker))].slice(0, 24);
    const data = [];
    for (let i = 0; i < tickers.length; i += 6) {
      const results = await Promise.all(tickers.slice(i, i + 6).map(currentShare));
      for (const item of results) {
        if (item && item.evidenceCount >= 3 && item.liquidityAudit?.isLiquid &&
            Date.parse(item.asOf) >= checkedAt.getTime() - 5 * 60_000) data.push(item);
      }
    }
    data.sort((a, b) => b.evidenceCount - a.evidenceCount);
    return finish({ checkedAt: checkedAt.toISOString(), data, scanned: tickers.length,
      message: 'Fresh bullish setups in a limited catalog sample. Target is +2% from the displayed quote; earlier daily gains do not count. These rules do not establish a probability of reaching the target.' }, 'intraday-momentum-4conditions-v1');
  } catch {
    return respond({ error: 'Current market data is unavailable. Retry the scan.' }, 503);
  }
}

export async function GET(request: NextRequest) { return run(request); }

export async function POST(request: NextRequest) {
  const denied = await guardAiRequest(request);
  if (denied) return denied;
  const auth = await requireAuth(request);
  if (!auth.authenticated) return auth.response;
  return run(request, auth.session.user.email.toLowerCase());
}
