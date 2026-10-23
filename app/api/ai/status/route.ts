import { NextResponse } from 'next/server';
import { getAiProviderStatus } from '../../../../lib/ollama-service';

export const dynamic = 'force-dynamic';


export async function GET() {
  try {
    const status = await getAiProviderStatus();
    return NextResponse.json(status);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to query AI provider status' },
      { status: 500 }
    );
  }
}
