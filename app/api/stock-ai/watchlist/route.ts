import { getAxionProjectRoot } from '../../../../lib/project-root';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    let stockAiDir = path.resolve(getAxionProjectRoot(), 'stock-ai');
    if (!fs.existsSync(stockAiDir)) {
      stockAiDir = path.resolve(getAxionProjectRoot(), '..', 'stock-ai');
    }

    const reportPath = path.join(stockAiDir, 'outputs', 'daily_watchlist_latest.md');
    if (!fs.existsSync(reportPath)) {
      return NextResponse.json({
        success: false,
        error: 'No watchlist report found yet. Run the EOD Scanner first.',
      });
    }

    const markdown = fs.readFileSync(reportPath, 'utf-8');

    return NextResponse.json({
      success: true,
      markdown,
      lastModified: fs.statSync(reportPath).mtime.toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch watchlist' },
      { status: 500 }
    );
  }
}
