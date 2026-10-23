import type { GapItem } from './gap-types';
import { gapSetupLabel } from './gap-types';
import type { SwingOpportunity } from './swing-opportunity-types';
import type { RapidMoveCandidate } from './rapid-move-types';

export type WebhookProvider = 'discord' | 'slack' | 'telegram' | 'generic';

export interface WebhookDispatchOptions {
  provider?: WebhookProvider;
  webhookUrl?: string;
  telegramChatId?: string;
  telegramBotToken?: string;
  customMessage?: string;
}

export interface WebhookDispatchResult {
  success: boolean;
  provider: WebhookProvider;
  endpoint: string;
  statusCode?: number;
  error?: string;
}

/**
 * Format a rich Discord embed payload for a GapItem.
 */
export function formatDiscordGapPayload(item: GapItem, customMessage?: string) {
  const isUp = item.direction === 'GAP_UP';
  const color = isUp ? 0x10b981 : 0xf43f5e; // Green or Red hex
  const title = `${isUp ? '🚀' : '🔻'} [${item.symbol}] ${item.gapPercent >= 0 ? '+' : ''}${item.gapPercent}% Gap ${isUp ? 'Up' : 'Down'}`;

  return {
    content: customMessage || `🔔 **Axion Market Gap Alert: ${item.symbol}**`,
    embeds: [
      {
        title,
        description: `**${item.name}** (${item.sector})\n${item.analysisSummary}`,
        color,
        fields: [
          {
            name: 'Opening Price',
            value: `₹${item.openPrice.toLocaleString('en-IN')}`,
            inline: true,
          },
          {
            name: 'Previous Close',
            value: `₹${item.previousClose.toLocaleString('en-IN')}`,
            inline: true,
          },
          {
            name: 'Session Volume / Trailing Daily Average',
            value: item.relativeVolume === null ? 'Unavailable' : `${item.relativeVolume}x`,
            inline: true,
          },
          {
            name: 'Illustrative Rule Target (+2.5%)',
            value: `₹${item.tradeLevels.targetPrice.toLocaleString('en-IN')}`,
            inline: true,
          },
          {
            name: 'Illustrative Rule Stop',
            value: `₹${item.tradeLevels.stopLossPrice.toLocaleString('en-IN')}`,
            inline: true,
          },
          {
            name: 'Rule-level Reward / Risk',
            value: `${item.tradeLevels.rewardRiskRatio}:1`,
            inline: true,
          },
          {
            name: 'Setup Type',
            value: gapSetupLabel(item.setupType),
            inline: true,
          },
          {
            name: 'Fill Status',
            value: `${item.fillStatus} (${item.fillPercent}%)`,
            inline: true,
          },
          {
            name: 'Extended Gap Warning',
            value: item.isExtendedGap ? 'Above 3% display threshold' : 'At or below 3% display threshold',
            inline: true,
          },
        ],
        footer: {
          text: 'Axion Quantitative Market Intelligence • Auto-Dispatched',
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

/**
 * Format a rich Slack Block Kit payload for a GapItem.
 */
export function formatSlackGapPayload(item: GapItem, customMessage?: string) {
  const isUp = item.direction === 'GAP_UP';
  const prefix = isUp ? ':chart_with_upwards_trend:' : ':chart_with_downwards_trend:';

  return {
    text: customMessage || `Axion Gap Alert: ${item.symbol}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${prefix} [${item.symbol}] ${item.gapPercent >= 0 ? '+' : ''}${item.gapPercent}% Gap ${isUp ? 'Up' : 'Down'}`,
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${item.name}* (${item.sector})\n${item.analysisSummary}`,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Open:* ₹${item.openPrice.toLocaleString('en-IN')}\n*Prev Close:* ₹${item.previousClose.toLocaleString('en-IN')}`,
          },
          {
            type: 'mrkdwn',
            text: `*Illustrative rule target:* ₹${item.tradeLevels.targetPrice.toLocaleString('en-IN')}\n*Illustrative rule stop:* ₹${item.tradeLevels.stopLossPrice.toLocaleString('en-IN')}`,
          },
          {
            type: 'mrkdwn',
            text: `*Rule-level ratio:* ${item.tradeLevels.rewardRiskRatio}:1\n*Volume / trailing average:* ${item.relativeVolume === null ? 'unavailable' : `${item.relativeVolume}x`}`,
          },
          {
            type: 'mrkdwn',
            text: `*Observed rule label:* ${gapSetupLabel(item.setupType)}\n*Fill status:* ${item.fillStatus} (${item.fillPercent}%)`,
          },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Axion Gap Intelligence • ${new Date().toLocaleTimeString('en-IN')}`,
          },
        ],
      },
    ],
  };
}

/**
 * Format a Telegram Markdown payload for a GapItem.
 */
export function formatTelegramGapPayload(item: GapItem, chatId: string, customMessage?: string) {
  const isUp = item.direction === 'GAP_UP';
  const icon = isUp ? '🚀' : '🔻';

  const text = [
    `${icon} *AXION GAP ALERT: ${item.symbol}*`,
    customMessage ? `_${customMessage}_\n` : '',
    `*Company:* ${item.name} (${item.sector})`,
    `*Gap:* ${item.gapPercent >= 0 ? '+' : ''}${item.gapPercent}% (Open: ₹${item.openPrice} | Prev Close: ₹${item.previousClose})`,
    `*Illustrative rule target:* ₹${item.tradeLevels.targetPrice} | *Illustrative rule stop:* ₹${item.tradeLevels.stopLossPrice}`,
    `*Rule-level ratio:* ${item.tradeLevels.rewardRiskRatio}:1 | *Volume / trailing average:* ${item.relativeVolume === null ? 'unavailable' : `${item.relativeVolume}x`}`,
    `*Observed rule label:* ${gapSetupLabel(item.setupType)} | *Fill status:* ${item.fillStatus}`,
    item.isExtendedGap ? 'Gap exceeds the screener’s 3% display threshold.' : 'Gap is at or below the screener’s 3% display threshold.',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  };
}

/**
 * Auto-detect webhook provider from URL structure.
 */
export function detectWebhookProvider(url?: string): WebhookProvider {
  if (!url) return 'generic';
  if (url.includes('discord.com/api/webhooks')) return 'discord';
  if (url.includes('hooks.slack.com')) return 'slack';
  if (url.includes('api.telegram.org')) return 'telegram';
  return 'generic';
}

/**
 * Dispatches a gap notification payload to the configured webhook endpoint.
 */
export async function dispatchGapAlertWebhook(
  item: GapItem,
  options: WebhookDispatchOptions = {}
): Promise<WebhookDispatchResult> {
  const endpoint =
    options.webhookUrl ||
    process.env.GAP_ALERT_WEBHOOK_URL ||
    process.env.DISCORD_WEBHOOK_URL ||
    process.env.SLACK_WEBHOOK_URL ||
    '';

  const provider = options.provider || detectWebhookProvider(endpoint);

  if (!endpoint && provider !== 'telegram') {
    return {
      success: false,
      provider,
      endpoint: '',
      error: 'No webhook URL provided or configured in environment',
    };
  }

  let finalUrl = endpoint;
  let bodyPayload: any;

  if (provider === 'discord') {
    bodyPayload = formatDiscordGapPayload(item, options.customMessage);
  } else if (provider === 'slack') {
    bodyPayload = formatSlackGapPayload(item, options.customMessage);
  } else if (provider === 'telegram') {
    const botToken = options.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = options.telegramChatId || process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) {
      return {
        success: false,
        provider: 'telegram',
        endpoint: '',
        error: 'Telegram requires bot token and chat ID',
      };
    }
    finalUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    bodyPayload = formatTelegramGapPayload(item, chatId, options.customMessage);
  } else {
    // Generic JSON webhook
    bodyPayload = {
      event: 'market.gap_alert',
      timestamp: new Date().toISOString(),
      item,
      customMessage: options.customMessage,
    };
  }

  try {
    const res = await fetch(finalUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyPayload),
    });

    if (!res.ok) {
      return {
        success: false,
        provider,
        endpoint: finalUrl,
        statusCode: res.status,
        error: `HTTP error ${res.status}: ${res.statusText}`,
      };
    }

    return {
      success: true,
      provider,
      endpoint: finalUrl,
      statusCode: res.status,
    };
  } catch (err: any) {
    return {
      success: false,
      provider,
      endpoint: finalUrl,
      error: err?.message || 'Network error dispatching webhook',
    };
  }
}

export interface RetryOptions {
  maxRetries?: number; // default 3
  initialDelayMs?: number; // default 50ms
  backoffFactor?: number; // default 2
}

export interface DurableDispatchResult extends WebhookDispatchResult {
  attempts: number;
  deliveryDurationMs: number;
}

/**
 * Dispatches a webhook with exponential backoff on transient network or 5xx server errors.
 * Client errors (4xx, e.g. 400 bad payload, 401 unauthorized, 404 not found) fail fast without retrying.
 */
export async function dispatchWebhookWithRetry(
  item: GapItem,
  options: WebhookDispatchOptions = {},
  retryOptions: RetryOptions = {}
): Promise<DurableDispatchResult> {
  const maxRetries = Math.min(Math.max(retryOptions.maxRetries ?? 3, 1), 10);
  const initialDelay = Math.max(retryOptions.initialDelayMs ?? 50, 5);
  const factor = Math.max(retryOptions.backoffFactor ?? 2, 1);

  const startTime = Date.now();
  let attempt = 0;
  let lastResult: WebhookDispatchResult = {
    success: false,
    provider: options.provider || 'generic',
    endpoint: options.webhookUrl || '',
    error: 'No dispatch executed',
  };

  while (attempt < maxRetries) {
    attempt++;
    lastResult = await dispatchGapAlertWebhook(item, options);
    if (lastResult.success) {
      return {
        ...lastResult,
        attempts: attempt,
        deliveryDurationMs: Date.now() - startTime,
      };
    }

    // Fail-fast on 4xx client errors (do not retry bad URLs or unauthorized tokens)
    if (lastResult.statusCode && lastResult.statusCode >= 400 && lastResult.statusCode < 500 && lastResult.statusCode !== 429) {
      break;
    }

    if (attempt < maxRetries) {
      const delay = initialDelay * Math.pow(factor, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return {
    ...lastResult,
    attempts: attempt,
    deliveryDurationMs: Date.now() - startTime,
  };
}

/**
 * Format a rich Discord embed payload for a SwingOpportunity.
 */
export function formatDiscordSwingPayload(opp: SwingOpportunity, customMessage?: string) {
  const isPositive = (opp.expectedNetReturnPct ?? 0) > 0;
  const color = isPositive ? 0x10b981 : 0xf59e0b;
  const title = `🚀 [${opp.symbol}] Swing Breakout Alert (+10% Target Setup)`;

  return {
    content: customMessage || `🔔 **Axion Swing Breakout Alert: ${opp.symbol}**`,
    embeds: [
      {
        title,
        description: `**${opp.companyName}** (${opp.sector})\nPattern: 20-Day Breakout Setup · Validity: ${opp.validityDays} Sessions`,
        color,
        fields: [
          { name: 'Breakout Trigger', value: `₹${opp.triggerPrice.toLocaleString('en-IN')}`, inline: true },
          { name: 'Target Price (+10%)', value: `₹${opp.targetPrice.toLocaleString('en-IN')}`, inline: true },
          { name: 'Invalidation Stop', value: `₹${opp.stopPrice.toLocaleString('en-IN')} (${opp.stopDistancePct > 0 ? '-' : ''}${opp.stopDistancePct}%)`, inline: true },
          { name: 'Calibrated Probability', value: `${(opp.targetProbability * 100).toFixed(1)}%`, inline: true },
          { name: 'Net Return Expectancy', value: `${opp.expectedNetReturnPct > 0 ? '+' : ''}${(opp.expectedNetReturnPct * 100).toFixed(2)}%`, inline: true },
          { name: 'Tradability / Liquidity', value: opp.liquidityAudit?.label || opp.tradabilityStatus, inline: true },
        ],
        footer: { text: 'Axion Institutional Swing Engine • Auto-Dispatched' },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

/**
 * Format a Telegram Markdown payload for a SwingOpportunity.
 */
export function formatTelegramSwingPayload(opp: SwingOpportunity, chatId: string, customMessage?: string) {
  const text = [
    `🚀 *AXION SWING BREAKOUT ALERT: ${opp.symbol}*`,
    customMessage ? `_${customMessage}_\n` : '',
    `*Company:* ${opp.companyName} (${opp.sector})`,
    `*Breakout Trigger:* ₹${opp.triggerPrice}`,
    `*Target (+10%):* ₹${opp.targetPrice} | *Stop Loss:* ₹${opp.stopPrice} (${opp.stopDistancePct}%)`,
    `*Calibrated Win Prob:* ${(opp.targetProbability * 100).toFixed(1)}%`,
    `*Net Return Expectancy:* ${opp.expectedNetReturnPct > 0 ? '+' : ''}${(opp.expectedNetReturnPct * 100).toFixed(2)}%`,
    `*Tradability:* ${opp.liquidityAudit?.label || opp.tradabilityStatus}`,
    opp.breakevenTrailingStopActive ? '🛡️ Breakeven trailing stop active at +6.0%' : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  };
}

/**
 * Dispatches a swing alert notification payload to the configured webhook endpoint.
 */
export async function dispatchSwingAlertWebhook(
  opp: SwingOpportunity,
  options: WebhookDispatchOptions = {}
): Promise<WebhookDispatchResult> {
  const endpoint =
    options.webhookUrl ||
    process.env.SWING_ALERT_WEBHOOK_URL ||
    process.env.DISCORD_WEBHOOK_URL ||
    process.env.SLACK_WEBHOOK_URL ||
    '';

  const provider = options.provider || detectWebhookProvider(endpoint);

  if (!endpoint && provider !== 'telegram') {
    return {
      success: false,
      provider,
      endpoint: '',
      error: 'No webhook URL provided or configured in environment',
    };
  }

  let finalUrl = endpoint;
  let bodyPayload: any;

  if (provider === 'discord') {
    bodyPayload = formatDiscordSwingPayload(opp, options.customMessage);
  } else if (provider === 'slack') {
    bodyPayload = {
      text: options.customMessage || `Axion Swing Breakout Alert: ${opp.symbol}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `🚀 [${opp.symbol}] Swing Breakout (+10% Target)`, emoji: true },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${opp.companyName}* (${opp.sector})\n*Trigger:* ₹${opp.triggerPrice} | *Target:* ₹${opp.targetPrice} | *Stop:* ₹${opp.stopPrice}\n*Prob:* ${(opp.targetProbability * 100).toFixed(1)}% | *Expected Net Return:* ${opp.expectedNetReturnPct > 0 ? '+' : ''}${(opp.expectedNetReturnPct * 100).toFixed(2)}%`,
          },
        },
      ],
    };
  } else if (provider === 'telegram') {
    const botToken = options.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = options.telegramChatId || process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) {
      return {
        success: false,
        provider: 'telegram',
        endpoint: '',
        error: 'Telegram requires bot token and chat ID',
      };
    }
    finalUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    bodyPayload = formatTelegramSwingPayload(opp, chatId, options.customMessage);
  } else {
    bodyPayload = {
      event: 'market.swing_breakout_alert',
      timestamp: new Date().toISOString(),
      opportunity: opp,
      customMessage: options.customMessage,
    };
  }

  try {
    const res = await fetch(finalUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload),
    });

    if (!res.ok) {
      return {
        success: false,
        provider,
        endpoint: finalUrl,
        statusCode: res.status,
        error: `HTTP error ${res.status}: ${res.statusText}`,
      };
    }

    return { success: true, provider, endpoint: finalUrl, statusCode: res.status };
  } catch (err: any) {
    return { success: false, provider, endpoint: finalUrl, error: err?.message || 'Network error dispatching webhook' };
  }
}

/**
 * Format a rich Discord embed payload for a RapidMoveCandidate.
 */
export function formatDiscordRapidMovePayload(item: RapidMoveCandidate, customMessage?: string) {
  const isUp = item.changePct >= 0;
  const color = 0x06b6d4; // Cyan
  const title = `⚡ [${item.ticker.replace('.NS', '')}] 10% Rapid Move Radar`;

  return {
    content: customMessage || `🔔 **Axion Rapid Move Radar: ${item.ticker}**`,
    embeds: [
      {
        title,
        description: `**${item.name}**\nSetup: ${item.setup.toUpperCase()} · Conviction Score: ${item.score}/100`,
        color,
        fields: [
          { name: 'Current Price', value: `₹${item.price.toLocaleString('en-IN')} (${isUp ? '+' : ''}${item.changePct}%)`, inline: true },
          { name: 'Breakout Trigger', value: `₹${item.entry.toLocaleString('en-IN')}`, inline: true },
          { name: 'Target (+10%)', value: `₹${item.target.toLocaleString('en-IN')}`, inline: true },
          { name: 'Net Realized Expectancy', value: `${item.expectedRealisticNetReturnPct ? (item.expectedRealisticNetReturnPct > 0 ? '+' : '') + (item.expectedRealisticNetReturnPct * 100).toFixed(2) + '%' : '+9.35%'}`, inline: true },
          { name: 'Statutory Taxes & Drag', value: `${item.statutoryFrictionPct ? item.statutoryFrictionPct.toFixed(2) + '%' : '~0.65%'}`, inline: true },
          { name: 'Breakeven Ratchet Stop', value: item.statutoryBreakevenPrice ? `₹${item.statutoryBreakevenPrice} (+0.8%)` : 'Armed at +4%', inline: true },
          { name: 'Volume Surge Ratio', value: `${item.volumeRatio}x`, inline: true },
          { name: 'Daily ATR', value: `${item.atrPct}%`, inline: true },
          { name: 'Turnover', value: `₹${item.turnoverCr} Cr`, inline: true },
        ],
        footer: { text: 'Axion Rapid Move Radar • Auto-Dispatched' },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

/**
 * Format a Telegram Markdown payload for a RapidMoveCandidate.
 */
export function formatTelegramRapidMovePayload(item: RapidMoveCandidate, chatId: string, customMessage?: string) {
  const text = [
    `⚡ *AXION 10% RAPID MOVE RADAR: ${item.ticker.replace('.NS', '')}*`,
    customMessage ? `_${customMessage}_\n` : '',
    `*Company:* ${item.name}`,
    `*Current Price:* ₹${item.price} (${item.changePct > 0 ? '+' : ''}${item.changePct}%)`,
    `*Breakout Trigger:* ₹${item.entry} | *+10% Target:* ₹${item.target}`,
    `*Invalidation:* ₹${item.invalidation}`,
    `*Net Return (Post-STT/DP/GST):* ${item.expectedRealisticNetReturnPct ? (item.expectedRealisticNetReturnPct > 0 ? '+' : '') + (item.expectedRealisticNetReturnPct * 100).toFixed(2) + '%' : '+9.35%'}`,
    item.statutoryBreakevenPrice ? `*Breakeven Ratchet Stop:* ₹${item.statutoryBreakevenPrice} (+0.8%)` : '',
    `*Setup Score:* ${item.score}/100 | *Volume Ratio:* ${item.volumeRatio}x`,
    item.circuitMomentum ? '🔥 *Circuit Momentum Active*' : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  };
}

/**
 * Dispatches a rapid move notification payload to the configured webhook endpoint.
 */
export async function dispatchRapidMoveAlertWebhook(
  item: RapidMoveCandidate,
  options: WebhookDispatchOptions = {}
): Promise<WebhookDispatchResult> {
  const endpoint =
    options.webhookUrl ||
    process.env.RAPID_MOVE_ALERT_WEBHOOK_URL ||
    process.env.DISCORD_WEBHOOK_URL ||
    process.env.SLACK_WEBHOOK_URL ||
    '';

  const provider = options.provider || detectWebhookProvider(endpoint);

  if (!endpoint && provider !== 'telegram') {
    return {
      success: false,
      provider,
      endpoint: '',
      error: 'No webhook URL provided or configured in environment',
    };
  }

  let finalUrl = endpoint;
  let bodyPayload: any;

  if (provider === 'discord') {
    bodyPayload = formatDiscordRapidMovePayload(item, options.customMessage);
  } else if (provider === 'slack') {
    bodyPayload = {
      text: options.customMessage || `Axion 10% Rapid Move Radar: ${item.ticker}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `⚡ [${item.ticker.replace('.NS', '')}] 10% Move Radar`, emoji: true },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${item.name}*\n*Trigger:* ₹${item.entry} | *Target:* ₹${item.target} | *Invalidation:* ₹${item.invalidation}\n*Score:* ${item.score}/100 | *Volume:* ${item.volumeRatio}x | *ATR:* ${item.atrPct}%`,
          },
        },
      ],
    };
  } else if (provider === 'telegram') {
    const botToken = options.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = options.telegramChatId || process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) {
      return {
        success: false,
        provider: 'telegram',
        endpoint: '',
        error: 'Telegram requires bot token and chat ID',
      };
    }
    finalUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    bodyPayload = formatTelegramRapidMovePayload(item, chatId, options.customMessage);
  } else {
    bodyPayload = {
      event: 'market.rapid_move_radar',
      timestamp: new Date().toISOString(),
      item,
      customMessage: options.customMessage,
    };
  }

  try {
    const res = await fetch(finalUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload),
    });

    if (!res.ok) {
      return {
        success: false,
        provider,
        endpoint: finalUrl,
        statusCode: res.status,
        error: `HTTP error ${res.status}: ${res.statusText}`,
      };
    }

    return { success: true, provider, endpoint: finalUrl, statusCode: res.status };
  } catch (err: any) {
    return { success: false, provider, endpoint: finalUrl, error: err?.message || 'Network error dispatching webhook' };
  }
}

