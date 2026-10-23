import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Personal deployment: access is configured by the owner through account:setup.
export async function POST() {
  return NextResponse.json({ success: false, error: 'Public registration is disabled for this personal workspace.' }, { status: 403 });
}
