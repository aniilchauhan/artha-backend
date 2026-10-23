import { createHash } from 'node:crypto';
import connectToDatabase from './mongodb';
import CompanyResearchReportModel from '../models/CompanyResearchReport';
import { ResearchError } from './company-research';
import type { CompanyResearchReport, ResearchHistoryPage, ResearchSaveReceipt, SavedResearchReport } from './research-types';

export const RESEARCH_HISTORY_PAGE_SIZE = 20;

export function researchOwnerId(user: { id?: string }): string {
  if (typeof user.id !== 'string' || !user.id.trim() || user.id.length > 200) {
    throw new ResearchError('Your account identity is unavailable. Sign in again to use research history.', 401);
  }
  return user.id.trim();
}

export function validateResearchReportId(id: unknown): string {
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new ResearchError('Invalid saved report identifier.', 400);
  return id;
}

export function researchReportKey(ownerId: string, report: CompanyResearchReport): string {
  return createHash('sha256').update(JSON.stringify([ownerId, report])).digest('hex');
}

// Save only reports generated on the server. A receipt never mutates the shared AI cache.
export async function saveResearchReport(ownerId: string, report: CompanyResearchReport): Promise<ResearchSaveReceipt> {
  try {
    researchOwnerId({ id: ownerId });
    const id = researchReportKey(ownerId, report);
    await connectToDatabase();
    let inserted = false;
    try {
      const result = await CompanyResearchReportModel.updateOne({ _id: id, ownerId }, { $setOnInsert: {
        ownerId, ticker: report.ticker, savedAt: new Date(), generatedAt: new Date(report.generatedAt),
        roles: report.roles.map(role => role.role), status: report.status,
        summary: report.kind === 'framework' && report.framework ? report.framework.summary
          : report.synthesis.review?.summary ?? 'Combined view unavailable; individual role reports are preserved.',
        report,
      } }, { upsert: true });
      inserted = result.upsertedCount === 1;
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 11000) throw error;
    }
    const stored = await CompanyResearchReportModel.findOne({ _id: id, ownerId }).select('savedAt').lean();
    if (!stored) throw new Error('Research save could not be confirmed');
    return { status: inserted ? 'saved' : 'existing', id, savedAt: new Date(stored.savedAt).toISOString(),
      message: inserted ? 'Saved to your research history.' : 'This report is already saved in your research history.' };
  } catch {
    return { status: 'unavailable', message: 'Not saved: research history is unavailable. The report remains readable here. Check the database connection and run research again to retry saving.' };
  }
}

export async function getResearchHistory(ownerId: string, ticker: string, cursor?: string): Promise<ResearchHistoryPage> {
  researchOwnerId({ id: ownerId });
  if (cursor !== undefined) validateResearchReportId(cursor);
  await connectToDatabase();
  const filter: Record<string, unknown> = { ownerId, ticker };
  if (cursor !== undefined) {
    const previous = await CompanyResearchReportModel.findOne({ _id: cursor, ownerId, ticker }).select('savedAt').lean();
    if (!previous) throw new ResearchError('The history cursor is unavailable. Refresh your saved reports.', 400);
    filter.$or = [{ savedAt: { $lt: previous.savedAt } }, { savedAt: previous.savedAt, _id: { $lt: cursor } }];
  }
  const documents = await CompanyResearchReportModel.find(filter)
    .select('ticker savedAt generatedAt roles status summary').sort({ savedAt: -1, _id: -1 })
    .limit(RESEARCH_HISTORY_PAGE_SIZE + 1).lean();
  const page = documents.slice(0, RESEARCH_HISTORY_PAGE_SIZE);
  return {
    items: page.map((doc: any) => ({ id: String(doc._id), ticker: doc.ticker, savedAt: new Date(doc.savedAt).toISOString(),
      generatedAt: new Date(doc.generatedAt).toISOString(), roles: doc.roles, status: doc.status, summary: doc.summary })),
    nextCursor: documents.length > RESEARCH_HISTORY_PAGE_SIZE ? String(page[page.length - 1]._id) : null,
  };
}

export async function getSavedResearchReport(ownerId: string, id: string): Promise<SavedResearchReport> {
  researchOwnerId({ id: ownerId });
  validateResearchReportId(id);
  await connectToDatabase();
  const stored = await CompanyResearchReportModel.findOne({ _id: id, ownerId }).select('savedAt report').lean();
  // A foreign ID and a nonexistent ID deliberately have the same response.
  if (!stored) throw new ResearchError('Saved research report not found.', 404);
  return { id: String(stored._id), savedAt: new Date(stored.savedAt).toISOString(), report: stored.report };
}
