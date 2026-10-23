import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import TradeRecord from '../../../../models/TradeRecord';
import {
  produceDailyReview,
  produceWeeklyReview,
  produceMonthlyReview,
  type TradeRecord as ITrackerTradeRecord,
} from '../../../../lib/outcome-tracker';

export const dynamic = 'force-dynamic';

function mapDocToTrackerRecord(doc: any): ITrackerTradeRecord {
  return {
    id: doc._id?.toString() ?? doc.id ?? '',
    symbol: doc.symbol,
    sector: doc.sector,
    setupType: doc.setupType,
    entryPrice: doc.entryPrice,
    stopPrice: doc.stopPrice,
    targetPrice: doc.targetPrice,
    convictionScore: doc.convictionScore,
    marketRegimeAtEntry: doc.marketRegimeAtEntry,
    entryTimestamp: doc.entryTimestamp,
    exitPrice: doc.exitPrice,
    exitReason: doc.exitReason,
    holdingDays: doc.holdingDays,
    netReturnPct: doc.netReturnPct,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type');
    const date = searchParams.get('date');

    if (!type || !['daily', 'weekly', 'monthly'].includes(type)) {
      return NextResponse.json(
        { error: 'Invalid or missing "type" parameter; must be "daily", "weekly", or "monthly"' },
        { status: 400 }
      );
    }

    if (!date || typeof date !== 'string') {
      return NextResponse.json(
        { error: 'Missing required "date" parameter (e.g. YYYY-MM-DD or YYYY-MM)' },
        { status: 400 }
      );
    }

    let records: ITrackerTradeRecord[] = [];
    try {
      await connectToDatabase();
      const docs = await TradeRecord.find({}).sort({ entryTimestamp: 1 }).lean();
      records = docs.map(mapDocToTrackerRecord);
    } catch (dbError) {
      console.warn('[Return-Improvement Reviews] MongoDB query failed, generating review from empty records:', dbError);
      records = [];
    }

    let review;
    switch (type) {
      case 'daily':
        review = produceDailyReview(records, date);
        break;
      case 'weekly':
        review = produceWeeklyReview(records, date);
        break;
      case 'monthly':
        review = produceMonthlyReview(records, date);
        break;
    }

    return NextResponse.json(review);
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
