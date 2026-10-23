import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const supportedTypes = new Set(['recent', 'upcoming', 'summary']);

export async function GET(request: NextRequest) {
  const type = new URL(request.url).searchParams.get('type') || 'recent';
  if (!supportedTypes.has(type)) {
    return NextResponse.json({ error: 'Invalid type.' }, { status: 400 });
  }

  return NextResponse.json(
    {
      status: 'unavailable',
      error: 'No verified company earnings data source is configured. Undated estimates and generated event dates are not shown.',
      data: [],
    },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
