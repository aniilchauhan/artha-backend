import { NextRequest, NextResponse } from 'next/server';
import { guardAiRequest } from '../../../lib/ai-request-guard';
import { parseResearchRequest, ResearchError } from '../../../lib/company-research';
import { getCompanyResearch } from '../../../lib/company-research-service';
import { requireAuth } from '../../../lib/auth-guard';
import { researchOwnerId, saveResearchReport } from '../../../lib/research-history-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const denied = await guardAiRequest(request);
  if (denied) return denied;
  const auth = await requireAuth(request);
  if (!auth.authenticated) return auth.response;
  try {
    const ownerId = researchOwnerId(auth.session.user);
    const text = await request.text();
    if (text.length > 2048) throw new ResearchError('Request is too large.', 413);
    let body: unknown;
    try { body = JSON.parse(text); }
    catch { throw new ResearchError('A JSON research request is required.', 400); }
    const { ticker, roles } = parseResearchRequest(body);
    const data = await getCompanyResearch(ticker, roles);
    const save = await saveResearchReport(ownerId, data);
    return NextResponse.json({ success: true, data, save }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ success: false,
      error: error instanceof ResearchError ? error.message : 'Company research failed. Please try again.' },
    { status: error instanceof ResearchError ? error.status : 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
