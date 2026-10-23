/**
 * Axion Broker Execution Guardrails and Two-Phase Approval Workflow
 * 
 * Satisfies Year 2 Backlog Epic 7:
 * "Broker-aware execution guardrails and approval workflow — trade approval layers,
 * replay-safe ledger rules, controlled venue access. Automated execution is gated by
 * explicit policy and human review."
 */

import crypto from 'node:crypto';

export type OrderApprovalStatus =
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'DISPATCHED_SANDBOX'
  | 'EXECUTED'
  | 'FAILED';

export interface BrokerOrderInput {
  orderId: string;
  symbol: string;
  exchange: 'NSE' | 'BSE';
  side: 'BUY' | 'SELL';
  quantity: number;
  limitPrice: number;
  stopLossPrice: number;
  portfolioEquity: number;
  idempotencyKey: string;
  strategyTag?: string;
}

export interface GuardrailPolicy {
  maxOrderValueInr: number;        // Maximum rupee value per single order (e.g. ₹50,000)
  maxRiskPerTradePct: number;      // Maximum loss as % of equity (e.g. 2.0%)
  allowedExchanges: Array<'NSE' | 'BSE'>;
  requireTwoPhaseApproval: boolean;
  isLiveExecutionEnabled: boolean; // Always false in Year 2 per governance
}

export const DEFAULT_GUARDRAIL_POLICY: GuardrailPolicy = {
  maxOrderValueInr: 50_000,
  maxRiskPerTradePct: 2.0,
  allowedExchanges: ['NSE', 'BSE'],
  requireTwoPhaseApproval: true,
  isLiveExecutionEnabled: false, // Strict Year 2 safety boundary
};

export interface BrokerOrderRecord {
  orderId: string;
  symbol: string;
  exchange: 'NSE' | 'BSE';
  side: 'BUY' | 'SELL';
  quantity: number;
  limitPrice: number;
  orderValueInr: number;
  riskAmountInr: number;
  riskPct: number;
  status: OrderApprovalStatus;
  idempotencyKey: string;
  replayDigest: string;
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  executionReceipt?: {
    venueOrderId: string;
    fillPrice: number;
    executedAt: string;
    simulatedFrictionBps: number;
  };
}

class BrokerExecutionGuardrails {
  private policy: GuardrailPolicy = { ...DEFAULT_GUARDRAIL_POLICY };
  private orders: Map<string, BrokerOrderRecord> = new Map();
  private processedDigests: Set<string> = new Set();

  public setPolicy(overrides: Partial<GuardrailPolicy>): void {
    this.policy = { ...this.policy, ...overrides };
  }

  public getPolicy(): GuardrailPolicy {
    return { ...this.policy };
  }

  /**
   * Submits an order for guardrail compliance checks and two-phase approval queue.
   */
  public submitOrderForApproval(input: BrokerOrderInput): {
    success: boolean;
    order?: BrokerOrderRecord;
    error?: string;
  } {
    // 1. Basic validation
    if (!input || input.quantity <= 0 || input.limitPrice <= 0) {
      return { success: false, error: 'Invalid order quantity or price.' };
    }

    // 2. Anti-replay digest verification
    const replayDigest = crypto
      .createHash('sha256')
      .update(`${input.orderId}:${input.symbol}:${input.side}:${input.quantity}:${input.limitPrice}:${input.idempotencyKey}`)
      .digest('hex');

    if (this.processedDigests.has(replayDigest)) {
      return {
        success: false,
        error: `Duplicate order detected (anti-replay invariant triggered for key ${input.idempotencyKey}).`,
      };
    }

    // 3. Exchange venue whitelist
    if (!this.policy.allowedExchanges.includes(input.exchange)) {
      return { success: false, error: `Exchange '${input.exchange}' is not in approved venue whitelist.` };
    }

    // 4. Order value limit check
    const orderValueInr = input.quantity * input.limitPrice;
    if (orderValueInr > this.policy.maxOrderValueInr) {
      return {
        success: false,
        error: `Order value ₹${orderValueInr.toFixed(2)} exceeds maximum per-trade limit of ₹${this.policy.maxOrderValueInr.toFixed(2)}.`,
      };
    }

    // 5. Portfolio risk percentage check
    const riskPerShare = Math.max(0, input.limitPrice - input.stopLossPrice);
    const totalRiskAmount = riskPerShare * input.quantity;
    const riskPct = input.portfolioEquity > 0 ? (totalRiskAmount / input.portfolioEquity) * 100 : 100;

    if (riskPct > this.policy.maxRiskPerTradePct) {
      return {
        success: false,
        error: `Per-trade portfolio risk (${riskPct.toFixed(2)}%) exceeds safety ceiling of ${this.policy.maxRiskPerTradePct.toFixed(2)}%.`,
      };
    }

    // 6. Register order in approval queue
    const record: BrokerOrderRecord = {
      orderId: input.orderId,
      symbol: input.symbol,
      exchange: input.exchange,
      side: input.side,
      quantity: input.quantity,
      limitPrice: input.limitPrice,
      orderValueInr,
      riskAmountInr: totalRiskAmount,
      riskPct: parseFloat(riskPct.toFixed(2)),
      status: 'PENDING_REVIEW',
      idempotencyKey: input.idempotencyKey,
      replayDigest,
      createdAt: new Date().toISOString(),
    };

    this.orders.set(input.orderId, record);
    this.processedDigests.add(replayDigest);

    return { success: true, order: record };
  }

  /**
   * Approves an order by an authorized human operator.
   */
  public approveOrder(orderId: string, reviewerId: string): { success: boolean; order?: BrokerOrderRecord; error?: string } {
    const order = this.orders.get(orderId);
    if (!order) return { success: false, error: 'Order not found.' };
    if (order.status !== 'PENDING_REVIEW') {
      return { success: false, error: `Cannot approve order in state '${order.status}'.` };
    }

    order.status = 'APPROVED';
    order.reviewedBy = reviewerId;
    order.reviewedAt = new Date().toISOString();

    return { success: true, order };
  }

  /**
   * Dispatches an approved order to the simulated sandbox venue.
   */
  public dispatchToSandbox(orderId: string): { success: boolean; order?: BrokerOrderRecord; error?: string } {
    const order = this.orders.get(orderId);
    if (!order) return { success: false, error: 'Order not found.' };
    if (order.status !== 'APPROVED') {
      return { success: false, error: `Order must be in APPROVED state before sandbox dispatch (current: '${order.status}').` };
    }

    order.status = 'DISPATCHED_SANDBOX';

    // Simulate immediate venue acknowledgment and execution
    order.status = 'EXECUTED';
    order.executionReceipt = {
      venueOrderId: `SANDBOX_NSE_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      fillPrice: order.limitPrice,
      executedAt: new Date().toISOString(),
      simulatedFrictionBps: 15, // 0.15% roundtrip friction
    };

    return { success: true, order };
  }

  public getOrder(orderId: string): BrokerOrderRecord | null {
    return this.orders.get(orderId) || null;
  }
}

export const brokerGuardrails = new BrokerExecutionGuardrails();
