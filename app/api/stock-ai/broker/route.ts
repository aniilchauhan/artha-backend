import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, verifyRequestOrigin } from '../../../../lib/auth-guard';
import { validateWebhookUrl } from '../../../../lib/webhook-guard';
import { executePythonScript, getStockAiDir } from '../../../../lib/python-runner';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';

/** Prevents CSV formula injection (cells starting with =, +, -, @). */
function sanitizeCsvCell(value: string): string {
  if (/^[=+\-@]/.test(value)) return `'${value}`;
  return value;
}

function sanitizeCsvContent(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.split(',').map(sanitizeCsvCell).join(','))
    .join('\n');
}

const VALID_BROKERS = new Set(['zerodha', 'angelone', 'dhan', 'generic']);
const VALID_MODES = new Set(['sandbox', 'live']);

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdmin(request);
    if (!authResult.authorized) {
      return authResult.response;
    }

    const stockAiDir = getStockAiDir();
    const receiptPath = path.join(stockAiDir, 'outputs', 'paper_trading', 'broker_dispatch_receipts.json');
    const basketPath = path.join(stockAiDir, 'outputs', 'paper_trading', 'zerodha_basket.csv');

    let receipt: any = null;
    let basketCsv: string | null = null;

    if (fs.existsSync(receiptPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(receiptPath, 'utf-8'));
        // Sanitize any internal machine file paths
        receipt = {
          broker: raw.broker,
          mode: raw.mode,
          timestamp: raw.timestamp || raw.generated_at,
          orders_count: raw.orders_count || (Array.isArray(raw.orders) ? raw.orders.length : 0),
          total_capital_required: raw.total_capital_required,
          status: raw.status,
          orders: raw.orders,
        };
      } catch (e: any) {
        console.warn('Error reading broker dispatch receipts:', e.message);
      }
    }

    if (fs.existsSync(basketPath)) {
      try {
        basketCsv = sanitizeCsvContent(fs.readFileSync(basketPath, 'utf-8'));
      } catch (e: any) {
        console.warn('Error reading zerodha basket CSV:', e.message);
      }
    }

    return NextResponse.json({
      success: true,
      supportedBrokers: [
        { id: 'zerodha', name: 'Zerodha Kite Connect', tag: 'KITE', type: 'REST API & Basket CSV' },
        { id: 'angelone', name: 'Angel One SmartAPI', tag: 'SMART', type: 'SmartAPI Delivery' },
        { id: 'dhan', name: 'Dhan HQ', tag: 'DHAN', type: 'Dhan HQ API' },
        { id: 'generic', name: 'Custom Webhook JSON', tag: 'WEBHOOK', type: 'Generic HTTP POST' },
      ],
      webhookDeliveryEnabled: process.env.ENABLE_BROKER_WEBHOOK === 'true',
      receipt,
      hasBasketCsv: !!basketCsv,
      basketCsv,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch broker status' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!verifyRequestOrigin(request)) {
      return NextResponse.json({ success: false, error: 'Invalid request origin' }, { status: 403 });
    }

    // Administrator permission required for order dispatch
    const authResult = await requireAdmin(request);
    if (!authResult.authorized) {
      return authResult.response;
    }

    const body = await request.json().catch(() => ({}));
    const broker = String(body.broker || 'zerodha').toLowerCase();
    const mode = String(body.mode || 'sandbox').toLowerCase();
    const operation = String(body.operation || (mode === 'sandbox' ? 'simulate_receipt' : 'dispatch_webhook'));
    const webhookUrl = body.webhookUrl ? String(body.webhookUrl) : undefined;

    if (!VALID_BROKERS.has(broker)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid broker: "${broker}". Supported: ${Array.from(VALID_BROKERS).join(', ')}`,
        },
        { status: 400 }
      );
    }

    if (!VALID_MODES.has(mode)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid mode: "${mode}". Supported: ${Array.from(VALID_MODES).join(', ')}`,
        },
        { status: 400 }
      );
    }

    // SSRF Validation: If webhook delivery is requested, validate the destination URL
    let validatedWebhookUrl: string | undefined;
    if (webhookUrl || operation === 'dispatch_webhook') {
      if (!webhookUrl) {
        return NextResponse.json(
          { success: false, error: 'Webhook URL is required for live webhook dispatch.' },
          { status: 400 }
        );
      }

      const validation = await validateWebhookUrl(webhookUrl);
      if (!validation.valid) {
        return NextResponse.json(
          {
            success: false,
            error: `Webhook destination rejected: ${validation.reason}`,
          },
          { status: 400 }
        );
      }
      validatedWebhookUrl = validation.sanitizedUrl;
    }

    const args = ['--broker', broker, '--mode', mode];
    if (validatedWebhookUrl) {
      args.push('--webhook-url', validatedWebhookUrl);
    }

    const execResult = await executePythonScript({
      scriptName: 'broker_dispatcher.py',
      args,
      timeoutMs: 30000,
      lockKey: 'stock-ai-broker',
      requiredArtifacts: [
        'outputs/paper_trading/broker_dispatch_receipts.json',
        'outputs/paper_trading/zerodha_basket.csv',
      ],
    });

    if (!execResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Broker order dispatcher failed to execute.',
          status: execResult.status,
          exitCode: execResult.exitCode,
        },
        { status: 502 }
      );
    }

    // Read the generated receipt
    const stockAiDir = getStockAiDir();
    const receiptPath = path.join(stockAiDir, 'outputs', 'paper_trading', 'broker_dispatch_receipts.json');
    const basketPath = path.join(stockAiDir, 'outputs', 'paper_trading', 'zerodha_basket.csv');

    let receipt: any = null;
    let basketCsv: string | null = null;

    if (fs.existsSync(receiptPath)) {
      try {
        receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf-8'));
      } catch {}
    }
    if (fs.existsSync(basketPath)) {
      try {
        basketCsv = sanitizeCsvContent(fs.readFileSync(basketPath, 'utf-8'));
      } catch {}
    }

    return NextResponse.json({
      success: true,
      operation,
      message:
        operation === 'simulate_receipt'
          ? `Simulated order basket receipt generated successfully for ${broker.toUpperCase()}`
          : `Orders successfully dispatched via ${broker.toUpperCase()} (${mode})`,
      durationMs: execResult.durationMs,
      freshness: {
        isFresh: execResult.artifactsFresh,
        metadata: execResult.artifactMetadata,
      },
      receipt,
      basketCsv,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to dispatch broker orders' },
      { status: 500 }
    );
  }
}
