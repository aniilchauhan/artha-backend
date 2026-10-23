import { NextRequest, NextResponse } from 'next/server';
import { readSnapshot, snapshotMetadata } from '../../../lib/backend-snapshots';
import type { RapidMoveBatch } from '../../../lib/rapid-move-types';
import fs from 'node:fs';
import path from 'node:path';
import { getAxionProjectRoot } from '../../../lib/project-root';
import { calculateIndianEquityFriction } from '../../../lib/indian-brokerage-calc';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const offset = request.nextUrl.searchParams.get('offset') ?? '0';
  if (!/^\d+$/.test(offset)) {
    return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
  }

  let batchData: RapidMoveBatch | null = null;
  let metaSnapshot: any = null;

  try {
    const snapshot = await readSnapshot<RapidMoveBatch>('rapid-moves');
    batchData = snapshot.data;
    metaSnapshot = await snapshotMetadata(snapshot);
  } catch {
    // 1. Try progress snapshot fallback
    try {
      const progSnap = await readSnapshot<RapidMoveBatch>('rapid-moves', true);
      batchData = progSnap.data;
      metaSnapshot = await snapshotMetadata(progSnap);
    } catch {
      // 2. Try raw disk snapshot fallback
      try {
        const diskPath = path.join(getAxionProjectRoot(), 'data', 'backend-snapshots', 'rapid-moves.json');
        if (fs.existsSync(diskPath)) {
          const raw = JSON.parse(fs.readFileSync(diskPath, 'utf8'));
          if (raw?.data?.candidates) {
            batchData = raw.data;
            metaSnapshot = {
              generatedAt: raw.generatedAt || new Date().toISOString(),
              marketDataAsOf: raw.marketDataAsOf || null,
              coverage: raw.coverage || { evaluated: raw.data.candidates.length, total: raw.data.total || 607 },
              status: 'ready',
              ageMs: 0,
            };
          }
        }
      } catch {}
    }
  }

  if (!batchData || !Array.isArray(batchData.candidates)) {
    return NextResponse.json(
      { error: 'No published radar scan. The backend worker must complete an update.' },
      { status: 503 }
    );
  }

  // Enrich candidates with exact Indian statutory taxes and dynamic ratchets
  const enrichedCandidates = batchData.candidates.map((c) => {
    const entry = c.entry > 0 ? c.entry : c.price;
    const target = c.target > 0 ? c.target : Number((entry * 1.085).toFixed(2));
    const invalidation = c.invalidation > 0 ? c.invalidation : Number((entry * 0.97).toFixed(2));

    const friction = calculateIndianEquityFriction({
      entryPrice: entry,
      exitPrice: target,
      positionValueINR: 50_000,
    });

    const statutoryFrictionPct = friction.totalFrictionPct;
    const expectedRealisticNetReturnPct = friction.netReturnPct;
    const riskRewardRatio = Number(((target - entry) / Math.max(0.01, entry - invalidation)).toFixed(2));
    const statutoryBreakevenPrice = Number((entry * 1.008).toFixed(2));
    const profitLockPrice = Number((entry * 1.045).toFixed(2));

    return {
      ...c,
      target,
      invalidation,
      statutoryFrictionPct,
      expectedRealisticNetReturnPct,
      riskRewardRatio,
      statutoryBreakevenPrice,
      profitLockPrice,
    };
  });

  // Rank highest-conviction and strongest volume-surge momentum setups first
  const sortedCandidates = [...enrichedCandidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.volumeRatio ?? 1) - (a.volumeRatio ?? 1);
  });

  return NextResponse.json(
    {
      ...batchData,
      candidates: sortedCandidates,
      nextOffset: null,
      snapshot: metaSnapshot || {
        generatedAt: new Date().toISOString(),
        marketDataAsOf: null,
        coverage: { evaluated: sortedCandidates.length, total: batchData.total || 607 },
        status: 'ready',
        ageMs: 0,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
