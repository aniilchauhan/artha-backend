import { NextRequest, NextResponse } from 'next/server';
import { rankSetups, type SetupForRanking } from '../../../../lib/ranking-engine';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    if (!body) {
      return NextResponse.json(
        { error: 'Invalid request body: JSON expected' },
        { status: 400 }
      );
    }

    const setups: SetupForRanking[] = Array.isArray(body)
      ? body
      : Array.isArray(body.setups)
      ? body.setups
      : null;

    if (!setups) {
      return NextResponse.json(
        { error: 'Invalid input: array of setups or { setups: [] } expected' },
        { status: 400 }
      );
    }

    const result = rankSetups(setups);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
