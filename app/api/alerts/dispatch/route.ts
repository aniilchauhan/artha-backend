import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyRequestOrigin } from '../../../../lib/auth-guard';
import { validateWebhookUrl } from '../../../../lib/webhook-guard';
import { alertAccountKey, readAlerts } from '../../../../lib/alert-store';
import {
  dispatchSwingAlertWebhook,
  dispatchRapidMoveAlertWebhook,
  detectWebhookProvider,
  type WebhookDispatchOptions,
} from '../../../../lib/webhook-dispatcher';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!verifyRequestOrigin(req)) {
    return NextResponse.json({ success: false, error: 'Invalid request origin.' }, { status: 403 });
  }

  const auth = await requireAuth(req);
  if (!auth.authenticated) return auth.response;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Invalid dispatch payload.' }, { status: 400 });
    }

    const key = alertAccountKey(auth.session.user.email);
    const userAlerts = await readAlerts(key);

    const type = body.type; // 'swing' | 'rapid' | 'generic'
    const payload = body.data;

    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ success: false, error: 'Missing opportunity or radar alert data.' }, { status: 400 });
    }

    // Determine target webhook URL from body or user preferences
    let targetWebhookUrl: string | undefined = body.webhookUrl || userAlerts.preferences?.channels?.webhookUrl;
    if (targetWebhookUrl) {
      const validation = await validateWebhookUrl(targetWebhookUrl);
      if (!validation.valid) {
        return NextResponse.json(
          { success: false, error: `Webhook URL rejected by security guard: ${validation.reason}` },
          { status: 400 }
        );
      }
      targetWebhookUrl = validation.sanitizedUrl;
    }

    const options: WebhookDispatchOptions = {
      webhookUrl: targetWebhookUrl,
      telegramChatId: body.telegramChatId || process.env.TELEGRAM_CHAT_ID,
      telegramBotToken: body.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN,
      customMessage: body.customMessage,
      provider: body.provider || detectWebhookProvider(targetWebhookUrl),
    };

    let dispatchResult;
    if (type === 'swing') {
      dispatchResult = await dispatchSwingAlertWebhook(payload, options);
    } else if (type === 'rapid') {
      dispatchResult = await dispatchRapidMoveAlertWebhook(payload, options);
    } else {
      return NextResponse.json({ success: false, error: 'Unsupported alert type: must be swing or rapid.' }, { status: 400 });
    }

    if (!dispatchResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: dispatchResult.error || 'Failed to dispatch alert to webhook provider.',
          provider: dispatchResult.provider,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Alert successfully routed to ${dispatchResult.provider.toUpperCase()} (${dispatchResult.endpoint || 'Telegram'})`,
      result: dispatchResult,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || 'Alert dispatch error' }, { status: 500 });
  }
}
