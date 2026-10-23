import { getAxionProjectRoot } from './project-root';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export interface AlertPreferences {
  cooldownMinutes: number; // default 15, range 0 - 1440
  maxDailyAlertsPerSymbol: number; // default 3, range 1 - 100
  channels: {
    inApp: boolean;
    sound: boolean;
    webhookUrl?: string;
  };
  marketHoursOnly: boolean; // default true (respect NSE 09:15-15:30 IST)
}

export const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  cooldownMinutes: 15,
  maxDailyAlertsPerSymbol: 3,
  channels: {
    inApp: true,
    sound: true,
  },
  marketHoursOnly: true,
};

export interface PriceAlertRuleOptions {
  direction?: 'above' | 'below';
  label?: string;
  cooldownMinutes?: number;
  maxDailyTriggers?: number;
  recurring?: boolean;
}

export interface PriceAlertRule {
  id: string;
  ticker: string;
  threshold: number;
  enabled: boolean;
  createdAt: string;
  direction?: 'above' | 'below';
  label?: string;
  cooldownMinutes?: number;
  maxDailyTriggers?: number;
  recurring?: boolean;
  lastTriggeredAt?: string;
  dailyTriggerCount?: number;
  dailyTriggerDate?: string;
  /** Smart signal alert type — fires on model signal rather than price threshold */
  alertType?: 'price' | 'squeeze' | 'high_conviction';
  /** Minimum conviction score for high_conviction alerts (0-100, default 70) */
  minConvictionScore?: number;
}

export interface PriceAlertEvent {
  id: string;
  ruleId: string;
  ticker: string;
  threshold: number;
  price: number;
  quoteAsOf: string;
  triggeredAt: string;
  read: boolean;
  direction?: 'above' | 'below';
  label?: string;
  /** Populated for smart signal alerts */
  alertType?: 'price' | 'squeeze' | 'high_conviction';
  convictionScore?: number;
  squeezeNote?: string;
}

export interface AlertState {
  rules: PriceAlertRule[];
  events: PriceAlertEvent[];
  preferences?: AlertPreferences;
}

export const alertDirectory = () => path.resolve(process.env.AXION_ALERTS_DIR || path.join(getAxionProjectRoot(), '.axion', 'alerts'));
export const alertAccountKey = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
const filename = (key: string) => {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid alert account');
  return path.join(alertDirectory(), `${key}.json`);
};

export async function readAlerts(key: string): Promise<AlertState> {
  try {
    const parsed = JSON.parse(await fs.readFile(filename(key), 'utf8'));
    if (!parsed.preferences) parsed.preferences = { ...DEFAULT_ALERT_PREFERENCES };
    return parsed;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return { rules: [], events: [], preferences: { ...DEFAULT_ALERT_PREFERENCES } };
    }
    throw error;
  }
}

// The local web app and worker share a durable volume and a short file lock.
// Provider requests must happen outside this lock. Failed writes preserve the old file.
export async function updateAlerts(key: string, change: (state: AlertState) => void): Promise<AlertState> {
  const file = filename(key), lock = `${file}.lock`;
  await fs.mkdir(alertDirectory(), { recursive: true });
  let held = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { await fs.mkdir(lock); held = true; break; }
    catch (error: any) {
      if (error.code !== 'EEXIST') throw error;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  if (!held) throw new Error('Alert storage is busy. Try again; if the server crashed, recover its stale lock first.');
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const state = await readAlerts(key);
    change(state);
    state.events = state.events.slice(-100);
    await fs.writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await fs.rename(temporary, file);
    return state;
  } finally {
    await fs.unlink(temporary).catch(() => {});
    await fs.rmdir(lock);
  }
}

export function setPriceAlert(
  state: AlertState,
  ticker: string,
  threshold: number | null,
  optionsOrDirection?: 'above' | 'below' | PriceAlertRuleOptions,
  labelParam?: string
) {
  const existing = state.rules.findIndex(rule => rule.ticker === ticker);
  if (existing >= 0) state.rules.splice(existing, 1);
  if (threshold !== null) {
    if (state.rules.length >= 100) throw new Error('Maximum 100 alert rules per account.');

    let options: PriceAlertRuleOptions = {};
    if (typeof optionsOrDirection === 'string') {
      options.direction = optionsOrDirection;
      if (labelParam) options.label = labelParam;
    } else if (optionsOrDirection && typeof optionsOrDirection === 'object') {
      options = optionsOrDirection;
    }

    state.rules.push({
      id: randomUUID(),
      ticker,
      threshold,
      enabled: true,
      createdAt: new Date().toISOString(),
      ...(options.direction ? { direction: options.direction } : {}),
      ...(options.label ? { label: options.label } : {}),
      ...(options.cooldownMinutes !== undefined ? { cooldownMinutes: options.cooldownMinutes } : {}),
      ...(options.maxDailyTriggers !== undefined ? { maxDailyTriggers: options.maxDailyTriggers } : {}),
      ...(options.recurring !== undefined ? { recurring: options.recurring } : {}),
    });
  }
}

export function updateAlertPreferences(
  state: AlertState,
  preferences: Partial<AlertPreferences>
): AlertPreferences {
  const current = state.preferences || { ...DEFAULT_ALERT_PREFERENCES };
  const updated: AlertPreferences = {
    ...current,
    ...(typeof preferences.cooldownMinutes === 'number' && Number.isFinite(preferences.cooldownMinutes) && preferences.cooldownMinutes >= 0 && preferences.cooldownMinutes <= 1440
      ? { cooldownMinutes: preferences.cooldownMinutes } : {}),
    ...(typeof preferences.maxDailyAlertsPerSymbol === 'number' && Number.isFinite(preferences.maxDailyAlertsPerSymbol) && preferences.maxDailyAlertsPerSymbol >= 1 && preferences.maxDailyAlertsPerSymbol <= 100
      ? { maxDailyAlertsPerSymbol: preferences.maxDailyAlertsPerSymbol } : {}),
    ...(typeof preferences.marketHoursOnly === 'boolean'
      ? { marketHoursOnly: preferences.marketHoursOnly } : {}),
    channels: {
      ...current.channels,
      ...(preferences.channels && typeof preferences.channels.inApp === 'boolean' ? { inApp: preferences.channels.inApp } : {}),
      ...(preferences.channels && typeof preferences.channels.sound === 'boolean' ? { sound: preferences.channels.sound } : {}),
      ...(preferences.channels && typeof preferences.channels.webhookUrl === 'string' ? { webhookUrl: preferences.channels.webhookUrl } : {}),
    },
  };
  state.preferences = updated;
  return updated;
}

export async function workerStatus() {
  try {
    const heartbeat = JSON.parse(await fs.readFile(path.join(alertDirectory(), 'worker.json'), 'utf8'));
    return { ...heartbeat, active: Date.now() - Date.parse(heartbeat.checkedAt) < 150_000 };
  } catch { return { active: false, checkedAt: null }; }
}
