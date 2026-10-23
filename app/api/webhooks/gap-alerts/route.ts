import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyRequestOrigin } from '../../../../lib/auth-guard';
import {
  dispatchGapAlertWebhook,
  detectWebhookProvider,
  type WebhookDispatchOptions,
} from '../../../../lib/webhook-dispatcher';
import type { GapItem } from '../../../../lib/gap-types';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });

export async function GET() {
  return json({
    success: true,
    supportedProviders: ['discord', 'slack', 'telegram', 'generic'],
    environmentConfigured: {
      discord: !!process.env.DISCORD_WEBHOOK_URL,
      slack: !!process.env.SLACK_WEBHOOK_URL,
      telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      generic: !!process.env.GAP_ALERT_WEBHOOK_URL,
    },
  });
}

export async function POST(req: NextRequest) {
  if (!verifyRequestOrigin(req)) {
    return json({ success: false, error: 'Invalid request origin.' }, 403);
  }

  const auth = await requireAuth(req);
  if (!auth.authenticated) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body || !body.gapItem) {
    return json({ success: false, error: 'Missing gapItem payload.' }, 400);
  }

  const gapItem: GapItem = body.gapItem;
  const options: WebhookDispatchOptions = body.options || {};

  try {
    const result = await dispatchGapAlertWebhook(gapItem, options);
    return json({
      success: result.success,
      result,
    }, result.success ? 200 : 400);
  } catch (err: any) {
    return json({ success: false, error: err?.message || 'Failed to dispatch webhook' }, 500);
  }
}
