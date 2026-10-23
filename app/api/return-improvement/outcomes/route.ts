import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import TradeRecord, { type ITradeRecord } from '../../../../models/TradeRecord';
import {
  computeAggregateMetrics,
  type TradeRecord as ITrackerTradeRecord,
  type TradeFilter,
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

// ─── GET: Filtered Trade Records & Metrics ───────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sector = searchParams.get('sector') || undefined;
    const setupType = searchParams.get('setupType') || undefined;
    const marketRegime = (searchParams.get('marketRegime') as 'bull' | 'neutral' | 'bear') || undefined;
    const fromDate = searchParams.get('fromDate') || undefined;
    const toDate = searchParams.get('toDate') || undefined;

    try {
      await connectToDatabase();

      const query: Record<string, any> = {};
      if (sector) query.sector = sector;
      if (setupType) query.setupType = setupType;
      if (marketRegime) query.marketRegimeAtEntry = marketRegime;
      if (fromDate || toDate) {
        query.entryTimestamp = {};
        if (fromDate) query.entryTimestamp.$gte = fromDate;
        if (toDate) query.entryTimestamp.$lte = toDate;
      }

      const docs = await TradeRecord.find(query).sort({ entryTimestamp: 1 }).lean();
      const records: ITrackerTradeRecord[] = docs.map(mapDocToTrackerRecord);
      const aggregateMetrics = computeAggregateMetrics(records);

      return NextResponse.json({
        records,
        aggregateMetrics,
      });
    } catch (dbError) {
      console.error('[Return-Improvement Outcomes] MongoDB read failed, falling back to degraded mode:', dbError);
      return NextResponse.json({
        records: [],
        aggregateMetrics: computeAggregateMetrics([]),
        degraded: true,
        error: 'Database connection currently unavailable',
      });
    }
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ─── POST: Record Trade Entry ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    if (
      !body ||
      typeof body.symbol !== 'string' ||
      typeof body.sector !== 'string' ||
      typeof body.setupType !== 'string' ||
      typeof body.entryPrice !== 'number' ||
      typeof body.stopPrice !== 'number' ||
      typeof body.targetPrice !== 'number' ||
      typeof body.convictionScore !== 'number' ||
      !['bull', 'neutral', 'bear'].includes(body.marketRegimeAtEntry)
    ) {
      return NextResponse.json(
        { error: 'Missing or invalid required trade record fields' },
        { status: 400 }
      );
    }

    const tradeData = {
      symbol: body.symbol,
      sector: body.sector,
      setupType: body.setupType,
      entryPrice: body.entryPrice,
      stopPrice: body.stopPrice,
      targetPrice: body.targetPrice,
      convictionScore: body.convictionScore,
      marketRegimeAtEntry: body.marketRegimeAtEntry,
      entryTimestamp: body.entryTimestamp || new Date().toISOString(),
      exitPrice: body.exitPrice,
      exitReason: body.exitReason,
      holdingDays: body.holdingDays,
      netReturnPct: body.netReturnPct,
    };

    try {
      await connectToDatabase();
      const created = await TradeRecord.create(tradeData);
      return NextResponse.json(
        {
          success: true,
          trade: mapDocToTrackerRecord(created),
        },
        { status: 201 }
      );
    } catch (dbError) {
      console.error('[Return-Improvement Outcomes] MongoDB write failed, returning degraded mode response:', dbError);
      return NextResponse.json(
        {
          success: false,
          degraded: true,
          error: 'Database write failed; operating in degraded mode',
          trade: tradeData,
        },
        { status: 200 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ─── PATCH: Record Trade Close ────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    if (!body || (!body.id && !body._id && !body.symbol)) {
      return NextResponse.json(
        { error: 'Trade identifier (id, _id, or symbol) is required' },
        { status: 400 }
      );
    }

    const updateFields: Record<string, any> = {};
    if (typeof body.exitPrice === 'number') updateFields.exitPrice = body.exitPrice;
    if (body.exitReason) updateFields.exitReason = body.exitReason;
    if (typeof body.holdingDays === 'number') updateFields.holdingDays = body.holdingDays;
    if (typeof body.netReturnPct === 'number') updateFields.netReturnPct = body.netReturnPct;

    try {
      await connectToDatabase();
      const query = body.id || body._id
        ? { _id: body.id || body._id }
        : { symbol: body.symbol };

      const updated = await TradeRecord.findOneAndUpdate(query, updateFields, {
        new: true,
      }).lean();

      if (!updated) {
        return NextResponse.json(
          { error: 'Trade record not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        trade: mapDocToTrackerRecord(updated),
      });
    } catch (dbError) {
      console.error('[Return-Improvement Outcomes] MongoDB update failed, degraded response:', dbError);
      return NextResponse.json(
        {
          success: false,
          degraded: true,
          error: 'Database update failed; operating in degraded mode',
        },
        { status: 200 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
