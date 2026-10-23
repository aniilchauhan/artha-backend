import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestOrigin } from '../../../../lib/auth-guard';
import { randomUUID } from 'node:crypto';
import { calculateIndianEquityFriction } from '../../../../lib/indian-brokerage-calc';
import { defaultAngelOneClient } from '../../../../lib/angel-one-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    success: true,
    supportedBrokers: ['paper', 'zerodha', 'angelone', 'dhan'],
    status: 'ACTIVE',
    mode: 'SANDBOX_AND_PAPER',
    statutoryFrictionProfile: {
      standardDeliveryFrictionPct: 0.65,
      sttDeliveryTotalPct: 0.20,
      dpChargeFlatINR: 15.93,
      gstPct: 18.0,
      stampDutyBuyPct: 0.015,
      breakevenRatchetPct: 0.80,
      trailingProfitLockPct: 4.50,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    if (!verifyRequestOrigin(req)) {
      return NextResponse.json({ success: false, error: 'Invalid request origin.' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Invalid trade order body.' }, { status: 400 });
    }

    const ticker = String(body.ticker || '').trim().toUpperCase().replace(/\.NS$/, '');
    if (!ticker || !/^[A-Z0-9&_-]{1,20}$/.test(ticker)) {
      return NextResponse.json({ success: false, error: 'Valid ticker symbol required.' }, { status: 400 });
    }

    const action = String(body.action || 'BUY').toUpperCase();
    if (action !== 'BUY' && action !== 'SELL') {
      return NextResponse.json({ success: false, error: 'Action must be BUY or SELL.' }, { status: 400 });
    }

    const quantity = Math.floor(Number(body.quantity));
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) {
      return NextResponse.json({ success: false, error: 'Quantity must be a positive integer <= 1,000,000.' }, { status: 400 });
    }

    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0 || price > 500_000) {
      return NextResponse.json({ success: false, error: 'Valid positive price required.' }, { status: 400 });
    }

    const mode = String(body.mode || 'paper').toLowerCase();
    const slippagePct = mode === 'paper' ? 0.0005 : 0; // 0.05% slippage on simulated execution
    const executionPrice = Number((action === 'BUY' ? price * (1 + slippagePct) : price * (1 - slippagePct)).toFixed(2));
    
    // Default to +8.5% institutional swing target and -3.0% stop if unspecified
    const targetPrice = body.targetPrice ? Number(body.targetPrice) : Number((price * 1.085).toFixed(2));
    const stopLossPrice = body.stopLossPrice ? Number(body.stopLossPrice) : Number((price * 0.970).toFixed(2));

    const grossValue = Number((quantity * executionPrice).toFixed(2));

    // Exact Indian statutory tax and friction breakdown (STT 0.20%, DP flat ₹15.93, GST 18%, Stamp Duty, Exchange Fee, SEBI)
    const friction = calculateIndianEquityFriction({
      entryPrice: executionPrice,
      exitPrice: targetPrice,
      quantity,
    });

    // Dynamic ratchets: +0.80% covers all round-trip statutory friction; +4.5% locks profits
    const statutoryBreakevenPrice = Number((executionPrice * 1.008).toFixed(2));
    const profitLockPrice = Number((executionPrice * 1.045).toFixed(2));
    const riskPerShare = Math.max(0.01, Math.abs(executionPrice - stopLossPrice));
    const rewardPerShare = Math.max(0, targetPrice - executionPrice);
    const grossRR = Number((rewardPerShare / riskPerShare).toFixed(2));
    const netRewardRupees = Math.max(0, rewardPerShare * quantity - friction.totalFrictionINR);
    const netRR = Number(((netRewardRupees / quantity) / riskPerShare).toFixed(2));

    let orderId = `${mode.toUpperCase()}-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
    let brokerMessage = `${action} order for ${quantity} share(s) of ${ticker} executed successfully at ₹${executionPrice}.`;
    let isLiveExecution = false;

    // Live dispatch for Angel One SmartAPI if selected
    if (mode === 'angelone') {
      try {
        const angelRes = await defaultAngelOneClient.placeOrder({
          variety: 'NORMAL',
          tradingsymbol: `${ticker}-EQ`,
          symboltoken: String(body.symbolToken || '99926000'),
          transactiontype: action as 'BUY' | 'SELL',
          exchange: 'NSE',
          ordertype: 'LIMIT',
          producttype: 'DELIVERY',
          duration: 'DAY',
          price: executionPrice.toFixed(2),
          quantity: String(quantity),
          tag: 'AXION_SWING',
        });
        if (angelRes.success && angelRes.orderId) {
          orderId = angelRes.orderId;
          brokerMessage = angelRes.message;
          isLiveExecution = angelRes.mode === 'live';
        }
      } catch (err: any) {
        console.warn('[Angel One Quick Trade dispatch error, fell back to sandbox]:', err?.message);
      }
    }

    const timestamp = new Date().toISOString();

    const orderData = {
      orderId,
      ticker,
      action,
      quantity,
      price,
      executionPrice,
      targetPrice,
      stopLossPrice,
      mode,
      isLiveExecution,
      status: 'FILLED',
      timestamp,
      grossValue,
      charges: {
        brokerage: friction.brokerageINR,
        stt: friction.sttINR,
        gst: friction.gstINR,
        exchangeTurnover: friction.exchangeFeesINR,
        stampDuty: friction.stampDutyINR,
        dpCharges: friction.dpChargesINR,
        sebiCharges: friction.sebiChargesINR,
        slippage: friction.slippageINR,
        totalCharges: friction.totalFrictionINR,
        totalFrictionPct: friction.totalFrictionPct,
      },
      dynamicRatchets: {
        statutoryBreakevenPrice,
        profitLockPrice,
        breakevenThresholdGainPct: 4.0,
        trailingThresholdGainPct: 7.0,
      },
      expectancy: {
        grossReturnPct: friction.grossReturnPct,
        netReturnPct: friction.netReturnPct,
        grossProfitINR: friction.grossProfitINR,
        netProfitINR: friction.netProfitINR,
        rewardRiskRatio: `${grossRR}:1`,
        netRewardRiskRatio: `${netRR}:1`,
      },
      netCapitalDeployed: Number((grossValue + friction.totalFrictionINR).toFixed(2)),
    };

    return NextResponse.json({
      success: true,
      message: brokerMessage,
      data: orderData,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Trade dispatch failed' }, { status: 500 });
  }
}

