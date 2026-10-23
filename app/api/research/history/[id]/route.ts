import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '../../../../../lib/auth-guard';
import { ResearchError } from '../../../../../lib/company-research';
import { getSavedResearchReport, researchOwnerId } from '../../../../../lib/research-history-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (!auth.authenticated) return auth.response;
  try {
    const ownerId = researchOwnerId(auth.session.user);
    const { id } = await context.params;
    const data = await getSavedResearchReport(ownerId, id);
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof ResearchError ? error.message : 'Saved research is unavailable. Check the database connection and try again.' },
      { status: error instanceof ResearchError ? error.status : 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
