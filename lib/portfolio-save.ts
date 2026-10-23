import { createHash } from 'node:crypto';

export const PORTFOLIO_FIELDS = ['holdings', 'portfolioCash', 'portfolioTransactions', 'portfolioRiskRules', 'portfolioEquityHistory'];

/** One document update commits the data, version and retry receipt together. */
export async function commitPortfolioSave(User: any, email: string, updates: Record<string, unknown>, expectedVersion: number, operationId: string) {
  const digest = createHash('sha256').update(JSON.stringify({ expectedVersion, updates })).digest('hex');
  const updated = await User.findOneAndUpdate({
    email,
    ...(expectedVersion === 0
      ? { $or: [{ portfolioVersion: 0 }, { portfolioVersion: { $exists: false } }] }
      : { portfolioVersion: expectedVersion }),
    'portfolioSaveReceipts.operationId': { $ne: operationId },
  }, {
    $set: updates,
    $inc: { portfolioVersion: 1 },
    $push: { portfolioSaveReceipts: { $each: [{ operationId, digest, version: expectedVersion + 1 }], $slice: -100 } },
  }, { new: true, runValidators: true }).select('portfolioVersion');
  if (updated) return { status: 200, body: { success: true, portfolioVersion: updated.portfolioVersion, operationId } };

  const current = await User.findOne({ email }).select('portfolioVersion portfolioSaveReceipts').lean();
  if (!current) return { status: 404, body: { success: false, error: 'User account not found.' } };
  const receipt = current.portfolioSaveReceipts?.find((item: any) => item.operationId === operationId);
  if (receipt?.digest === digest) {
    return { status: 200, body: { success: true, portfolioVersion: receipt.version, operationId } };
  }
  return { status: 409, body: { success: false, error: 'Your account has newer portfolio changes. Review your pending changes before continuing.' } };
}
