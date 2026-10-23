import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import PredictionJournal from '../../../../models/PredictionJournal';
import TradeRecord from '../../../../models/TradeRecord';
import { indiaDay } from '../../../../lib/market-quote';

export const dynamic = 'force-dynamic';

export interface TargetTier {
  tier: 'T1' | 'T2' | 'T3';
  label: string;
  price: number;
  returnPct: number;
  status?: 'hit' | 'active' | 'pending';
}

export interface DailyPredictionItem {
  id: string;
  ticker: string;
  companyName?: string;
  sector?: string;
  date: string;
  direction: 'LONG' | 'SHORT' | 'OBSERVATION';
  status: 'worked' | 'failed' | 'pending';
  predictedMove: string;
  entryPrice: number;
  targetPrice: number;
  stopPrice: number | null;
  actualPrice?: number;
  returnPct?: number;
  convictionScore: number | null;
  measuredReasons?: string[];
  evidenceMissing?: string[];
  issuedAt?: string;
  dataAsOf?: string;
  invalidation?: string;
  outcomeReason: string;
  model: string;
  setupType?: string;
  timeframe?: string;
  targetTiers?: TargetTier[];
  maxPotentialPct?: number;
  rewardRiskRatio?: number;
  potentialCategory?: 'scalp' | 'swing' | 'runner';
}

function enrichWithTargetTiers(item: DailyPredictionItem): DailyPredictionItem {
  if (item.targetTiers && item.targetTiers.length > 0) return item;

  const entry = item.entryPrice;
  const baseT1 = Math.abs((item.targetPrice - entry) / entry) * 100;
  // A recorded target is evidence; additional multiplied targets are not.
  if(!Number.isFinite(entry)||entry<=0||!Number.isFinite(baseT1))return item;
  const stopDistance=item.stopPrice!==null?Math.abs(entry-item.stopPrice):0;
  return {...item,targetTiers:[{tier:'T1',label:item.direction==='OBSERVATION'?'Recorded observation threshold':'Recorded target',price:item.targetPrice,returnPct:Number(baseT1.toFixed(2)),status:item.status==='worked'?'hit':'pending'}],
    maxPotentialPct:Number(baseT1.toFixed(2)),rewardRiskRatio:stopDistance>0?Number((Math.abs(item.targetPrice-entry)/stopDistance).toFixed(2)):undefined,
    potentialCategory:baseT1>=10?'runner':baseT1>=4?'swing':'scalp'};
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const requestedDate = searchParams.get('date');
    const universeParam = searchParams.get('universe') || 'curated';
    const potentialParam = (searchParams.get('potential') || 'all') as 'all' | 'scalp' | 'swing' | 'runner';

    const effectiveDate = requestedDate || indiaDay(new Date());
    const availableDates = new Set<string>([effectiveDate]);

    let dbItems: DailyPredictionItem[] = [];
    let databaseUnavailable=false;

    try {
      await connectToDatabase();

      // 1. Fetch from PredictionJournal with projection
      let journalQuery: any = PredictionJournal.find({});
      if (typeof journalQuery?.select === 'function') {
        journalQuery = journalQuery.select('_id ticker recordedAt outcome assessment promptVersion');
      }
      const journalDocs = await journalQuery
        .sort({ recordedAt: -1 })
        .limit(100)
        .lean();
      for (const doc of journalDocs) {
        const entryDate = doc.recordedAt ? new Date(doc.recordedAt).toISOString().slice(0, 10) : '';
        const targetDay = doc.outcome?.targetDay || entryDate;
        if (targetDay) availableDates.add(targetDay);

        if (targetDay === effectiveDate || entryDate === effectiveDate) {
          const isCompleted = doc.outcome?.status === 'completed';
          const eventOccurred = Boolean(doc.outcome?.eventOccurred);
          const status = !isCompleted
            ? 'pending'
            : (eventOccurred ? 'worked' : 'failed');

          const refPrice = doc.outcome?.referencePrice ?? doc.assessment?.context?.referencePrice;
          if (!Number.isFinite(refPrice) || refPrice <= 0) continue;
          const targetHigh = refPrice * 1.02;
          const closeReturn = typeof doc.outcome?.closeReturnPercent === 'number' ? doc.outcome.closeReturnPercent : undefined;

          dbItems.push({
            id: String(doc._id),
            ticker: doc.ticker,
            date: targetDay,
            direction: 'OBSERVATION',
            status,
            predictedMove: `Next-session +2% high-touch observation; not an executed trade`,
            entryPrice: refPrice,
            targetPrice: targetHigh,
            stopPrice: null,
            actualPrice: doc.outcome?.targetClose ?? undefined,
            returnPct: closeReturn,
            convictionScore: Number.isFinite(doc.assessment?.context?.baseline?.score)?Math.round(doc.assessment.context.baseline.score*100):null,
            measuredReasons:(doc.assessment?.evidence||[]).filter((e:any)=>typeof e.metric==='string'&&typeof e.interpretation==='string').map((e:any)=>{
              const value=doc.assessment?.context?.metrics?.[e.metric]??doc.assessment?.context?.sources?.find((s:any)=>s.id===e.metric)?.value;
              return `${e.metric}: ${value===undefined?'supporting value unavailable':value} — ${e.interpretation}`;
            }),
            evidenceMissing:doc.assessment?.context?.limitations||['Company and event evidence not supplied.'],
            issuedAt:doc.recordedAt?new Date(doc.recordedAt).toISOString():undefined,
            dataAsOf:doc.assessment?.context?.historyAsOf,
            invalidation:doc.assessment?.invalidation||'No recorded invalidation condition; this observation is not a trade plan.',
            outcomeReason: doc.outcome?.reason || (!isCompleted?'Outcome pending or excluded; no realized trade return.':eventOccurred ? '+2% Session High reached' : '+2% High not reached'),
            model: doc.assessment?.model || doc.promptVersion || 'Stock AI Model',
            timeframe: 'Next-Session High Touch',
          });
        }
      }

      // 2. Fetch from TradeRecord with projection
      let tradeQuery: any = TradeRecord.find({});
      if (typeof tradeQuery?.select === 'function') {
        tradeQuery = tradeQuery.select('_id symbol sector entryTimestamp entryPrice targetPrice stopPrice exitPrice netReturnPct convictionScore exitReason setupType');
      }
      const tradeDocs = await tradeQuery
        .sort({ entryTimestamp: -1 })
        .limit(100)
        .lean();
      for (const trade of tradeDocs) {
        const tradeDate = trade.entryTimestamp?.slice(0, 10);
        if (tradeDate) availableDates.add(tradeDate);
        if (tradeDate === effectiveDate && Number.isFinite(trade.entryPrice) && trade.entryPrice > 0 &&
            Number.isFinite(trade.targetPrice) && trade.targetPrice > 0 && Number.isFinite(trade.stopPrice) && trade.stopPrice > 0) {
          const worked = trade.exitReason === 'target_hit' || (trade.netReturnPct !== undefined && trade.netReturnPct > 0);
          const isClosed = trade.exitPrice !== undefined && trade.exitReason !== undefined;
          const status = !isClosed ? 'pending' : (worked ? 'worked' : 'failed');

          dbItems.push({
            id: String(trade._id),
            ticker: trade.symbol,
            sector: trade.sector,
            date: tradeDate,
            direction: 'LONG',
            status,
            predictedMove: `Target: ₹${trade.targetPrice} vs Stop: ₹${trade.stopPrice}`,
            entryPrice: trade.entryPrice,
            targetPrice: trade.targetPrice,
            stopPrice: trade.stopPrice,
            actualPrice: trade.exitPrice ?? undefined,
            returnPct: trade.netReturnPct || 0,
            convictionScore: trade.convictionScore,
            measuredReasons:[`Recorded setup: ${trade.setupType||'not supplied'}`,`Recorded entry ₹${trade.entryPrice}, target ₹${trade.targetPrice}, stop ₹${trade.stopPrice}.`],
            evidenceMissing:['Source indicator values and company profile were not embedded in this legacy trade record.'],
            issuedAt:trade.entryTimestamp,
            invalidation:`Recorded stop ₹${trade.stopPrice}; fill is not guaranteed.`,
            outcomeReason: trade.exitReason === 'target_hit'
              ? `Target achieved at ₹${trade.exitPrice}`
              : trade.exitReason === 'stop_hit'
              ? `Stop loss triggered at ₹${trade.exitPrice}`
              : (trade.exitReason || 'Active position pending exit'),
            model: 'Return Improvement Quality Gate',
            setupType: trade.setupType,
            timeframe: 'Lifecycle Trade',
          });
        }
      }
    } catch {
      // Missing records remain unavailable; never substitute invented historical prices.
      databaseUnavailable=true;
    }
    if(databaseUnavailable)return NextResponse.json({success:false,error:'Recorded prediction storage is unavailable. No substitute predictions are shown.'},{status:503,headers:{'Cache-Control':'no-store'}});

    const rawItems = dbItems;
    let items = rawItems.map(enrichWithTargetTiers);
    if (potentialParam !== 'all') {
      items = items.filter(i => i.potentialCategory === potentialParam);
    }

    const search = (searchParams.get('search') || '').trim().toLowerCase();
    const sector = searchParams.get('sector') || 'ALL';
    const statusFilter = searchParams.get('status') || 'all';
    items = items.filter(item => (!search || item.ticker.toLowerCase().includes(search) || item.companyName?.toLowerCase().includes(search)) &&
      (sector === 'ALL' || item.sector === sector) && (statusFilter === 'all' || item.status === statusFilter));
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get('limit') || '30', 10) || 30));
    const totalPages = Math.max(1, Math.ceil(items.length / limit));
    const page = Math.max(1, Math.min(totalPages, parseInt(searchParams.get('page') || '1', 10) || 1));

    const workedItems = items.filter(i => i.status === 'worked');
    const failedItems = items.filter(i => i.status === 'failed');
    const pendingItems = items.filter(i => i.status === 'pending');

    const completedCount = workedItems.length + failedItems.length;
    const winRatePct = completedCount > 0 ? Math.round((workedItems.length / completedCount) * 100) : 0;

    const avgWinReturnPct = workedItems.length > 0
      ? Number((workedItems.reduce((acc, cur) => acc + (cur.returnPct || 0), 0) / workedItems.length).toFixed(2))
      : 0;

    const avgLossReturnPct = failedItems.length > 0
      ? Number((failedItems.reduce((acc, cur) => acc + (cur.returnPct || 0), 0) / failedItems.length).toFixed(2))
      : 0;

    return NextResponse.json({
      success: true,
      selectedDate: effectiveDate,
      availableDates: [...availableDates].sort().reverse(),
      universe: universeParam, page, totalPages, limit,
      source: 'recorded_predictions',
      message: items.length ? undefined : 'No recorded predictions with price evidence for this date.',
      sectors: ['ALL', ...new Set(rawItems.map(item => item.sector).filter(Boolean))],
      summary: {
        total: items.length,
        worked: workedItems.length,
        failed: failedItems.length,
        pending: pendingItems.length,
        winRatePct,
        avgWinReturnPct,
        avgLossReturnPct,
      },
      predictions: items.slice((page - 1) * limit, page * limit),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve daily predictions performance' },
      { status: 500 }
    );
  }
}
