import { NextRequest, NextResponse } from 'next/server';
import { readSnapshot, snapshotMetadata } from '../../../../lib/backend-snapshots';
import { generateDailyMarketSessionReport, type DailyMarketSessionReport } from '../../../../lib/market-report-generator';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const snapshot = await readSnapshot<DailyMarketSessionReport>('market-session-report');
    if (snapshot.data.source?.dataSource !== 'provider' || !snapshot.data.source.sessionDate || !Number.isFinite(Date.parse(snapshot.data.source.quoteAsOf)) || !Number.isFinite(Date.parse(snapshot.data.source.latestQuoteAsOf))) {
      throw new Error('Published report predates provider-backed observations.');
    }
    return NextResponse.json({
      success: true,
      report: snapshot.data,
      snapshot: await snapshotMetadata(snapshot),
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'No published market session report. The backend worker must complete an update.' },
      { status: 503 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const date = body.date || undefined;
    const report = await generateDailyMarketSessionReport(date);

    let webhookDispatched = false;
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;

    if (body.dispatchWebhook && webhookUrl) {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: `Axion Market Session Briefing [${report.date}]\nProvider quotes evaluated: ${report.universeScanned}/${report.universeTotal}. Observed gap fill rate: ${report.gapSummary.fillRatePercent}%.`,
          }),
        });
        webhookDispatched = response.ok;
      } catch {
        // Log webhook dispatch failure non-critically
      }
    }

    return NextResponse.json({
      success: true,
      report,
      webhookDispatched,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to generate report' },
      { status: 500 }
    );
  }
}
