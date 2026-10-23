/**
 * AX-22, AX-23, AX-24: Durable Scheduled Scanner Daemon & Recovery Engine
 *
 * Implements:
 * 1. Scheduled Scanning Cadence (Pre-market 09:10, Intraday, Post-market 15:35 IST)
 * 2. Distributed / Local Single-Job Lease Locking
 * 3. Bounded Retries with Exponential Backoff and Checkpoint Recovery
 * 4. Stale-Service State Machine (fails gracefully without marking market evaluated)
 * 5. Actionable Notification Engine with Strict Event-ID Deduplication and Broker Disclaimers
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getAxionProjectRoot } from './project-root';

export type DaemonPhase =
  | 'PRE_MARKET'
  | 'INTRADAY_SCAN'
  | 'POST_MARKET_RECONCILE'
  | 'OFF_HOURS'
  | 'WEEKEND';

export type DaemonHealthStatus =
  | 'healthy'
  | 'degraded'
  | 'stale'
  | 'recovering'
  | 'stopped';

export interface DaemonCheckpoint {
  lastRunTimestamp: string;
  lastSuccessfulRun: string | null;
  lastSuccessfulPhase: DaemonPhase | null;
  status: DaemonHealthStatus;
  consecutiveFailures: number;
  lastError: string | null;
  staleSince: string | null;
  hostId: string;
  completedScanDates: string[];
}

export type ActionableNotificationType =
  | 'NEW_QUALIFYING_SIGNAL'
  | 'CONFIRMED_PAPER_FILL'
  | 'SETUP_INVALIDATED'
  | 'REVIEW_DEADLINE_DUE'
  | 'SERVICE_FAILURE_OR_STALE';

export interface ActionableNotification {
  id: string; // Deterministic deduplication key: e.g. "notif_sig_TRENT_NEW_SIGNAL"
  type: ActionableNotificationType;
  timestamp: string;
  title: string;
  message: string;
  relatedSignalId?: string;
  relatedOrderId?: string;
  brokerDisclaimer: string;
  read: boolean;
}

export function getDaemonDir(): string {
  const dir = process.env.AXION_DAEMON_DIR || path.join(getAxionProjectRoot(), '.axion', 'daemon');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getCheckpointPath(): string {
  return path.join(getDaemonDir(), 'checkpoint.json');
}

export function getNotificationsPath(): string {
  return path.join(getDaemonDir(), 'notifications.json');
}

export function getLockFilePath(): string {
  return path.join(getDaemonDir(), 'scanner.lock');
}

/**
 * Returns Indian Standard Time context and determines the market phase.
 */
export function getISTMarketContext(now = new Date()): {
  timeNum: number;
  dayOfWeek: number;
  isWeekend: number;
  dateStr: string;
  timeString: string;
  phase: DaemonPhase;
} {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(now);
  const field = (key: string) => parts.find(p => p.type === key)!.value;
  const hours = Number(field('hour')), minutes = Number(field('minute'));
  const dateStr = `${field('year')}-${field('month')}-${field('day')}`;
  const dayOfWeek = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  const timeNum = hours * 100 + minutes;
  const timeString = `${field('hour')}:${field('minute')}`;

  let phase: DaemonPhase = 'OFF_HOURS';
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    phase = 'WEEKEND';
  } else if (timeNum >= 910 && timeNum < 915) {
    phase = 'PRE_MARKET';
  } else if (timeNum >= 915 && timeNum <= 1530) {
    phase = 'INTRADAY_SCAN';
  } else if (timeNum > 1530 && timeNum <= 1600) {
    phase = 'POST_MARKET_RECONCILE';
  } else {
    phase = 'OFF_HOURS';
  }

  return {
    timeNum,
    dayOfWeek,
    isWeekend: dayOfWeek === 0 || dayOfWeek === 6 ? 1 : 0,
    dateStr,
    timeString,
    phase,
  };
}

/**
 * Reads or initializes the persistent daemon checkpoint.
 */
export function readDaemonCheckpoint(): DaemonCheckpoint {
  const cpPath = getCheckpointPath();
  if (fs.existsSync(cpPath)) {
    try {
      const content = fs.readFileSync(cpPath, 'utf8');
      return JSON.parse(content) as DaemonCheckpoint;
    } catch {
      // corrupt file, reinitialize
    }
  }

  const defaultCheckpoint: DaemonCheckpoint = {
    lastRunTimestamp: new Date().toISOString(),
    lastSuccessfulRun: null,
    lastSuccessfulPhase: null,
    status: 'healthy',
    consecutiveFailures: 0,
    lastError: null,
    staleSince: null,
    hostId: `host_${process.pid}_${crypto.randomBytes(4).toString('hex')}`,
    completedScanDates: [],
  };

  writeDaemonCheckpoint(defaultCheckpoint);
  return defaultCheckpoint;
}

/**
 * Persists the daemon checkpoint to disk.
 */
export function writeDaemonCheckpoint(checkpoint: DaemonCheckpoint): void {
  const cpPath = getCheckpointPath();
  fs.writeFileSync(cpPath, JSON.stringify(checkpoint, null, 2), 'utf8');
}

/**
 * Local file-based single-job lease locking for the scanner.
 */
export function acquireLocalLock(ttlMs = 60000): { acquired: boolean; release: () => void } {
  const lockPath = getLockFilePath();
  const now = Date.now();

  const token = crypto.randomUUID();
  try { fs.writeFileSync(lockPath, JSON.stringify({pid:process.pid, token, acquiredAt:now, expiresAt:now+ttlMs}), {flag:'wx'}); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    return {acquired:false, release:()=>{}};
  }
  return {acquired:true, release:()=>{
    const saved = JSON.parse(fs.readFileSync(lockPath,'utf8'));
    if (saved.token === token) fs.unlinkSync(lockPath);
  }};
}

/**
 * Executes one durable daemon cycle with bounded retries and recovery.
 */
export async function executeDurableDaemonCycle(options: {
  currentTime?: Date;
  scannerTask?: () => Promise<void>;
  mockScannerTask?: () => Promise<void>;
  maxRetries?: number;
}): Promise<{
  success: boolean;
  phase: DaemonPhase;
  status: DaemonHealthStatus;
  retriesAttempted: number;
  error?: string;
}> {
  const now = options.currentTime || new Date();
  const maxRetries = options.maxRetries ?? 3;
  const context = getISTMarketContext(now);
  const checkpoint = readDaemonCheckpoint();

  // Try acquiring single-job lease lock
  const lock = acquireLocalLock(60000);
  if (!lock.acquired) {
    return {
      success: false,
      phase: context.phase,
      status: 'degraded',
      retriesAttempted: 0,
      error: 'Job lock already held by another scanner instance.',
    };
  }

  checkpoint.lastRunTimestamp = now.toISOString();

  let retriesAttempted = 0;
  let taskSuccess = false;
  let lastError: Error | null = null;

  // Execute task with bounded exponential backoff
  const task = options.scannerTask ?? options.mockScannerTask;
  if (task) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await task();
        taskSuccess = true;
        break;
      } catch (err: any) {
        lastError = err;
        retriesAttempted = attempt;
        if (attempt < maxRetries) {
          // Bounded backoff
          const delayMs = Math.min(100 * Math.pow(2, attempt - 1), 1000);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
  } else {
    lastError = new Error('No scanner task configured; no successful run recorded.');
    retriesAttempted = 1;
  }

  lock.release();

  if (taskSuccess) {
    checkpoint.status = 'healthy';
    checkpoint.consecutiveFailures = 0;
    checkpoint.lastError = null;
    checkpoint.staleSince = null;
    checkpoint.lastSuccessfulRun = now.toISOString();
    checkpoint.lastSuccessfulPhase = context.phase;

    if (!checkpoint.completedScanDates.includes(context.dateStr)) {
      checkpoint.completedScanDates.push(context.dateStr);
    }

    writeDaemonCheckpoint(checkpoint);

    return {
      success: true,
      phase: context.phase,
      status: 'healthy',
      retriesAttempted,
    };
  } else {
    checkpoint.consecutiveFailures += retriesAttempted;
    checkpoint.lastError = lastError?.message || 'Scanner execution failure';

    if (retriesAttempted >= maxRetries || checkpoint.consecutiveFailures >= maxRetries) {
      checkpoint.status = 'stale';
      if (!checkpoint.staleSince) {
        checkpoint.staleSince = now.toISOString();
      }

      // Dispatch failure alert notification
      dispatchActionableNotification({
        id: `notif_outage_${context.dateStr}_${checkpoint.consecutiveFailures}`,
        type: 'SERVICE_FAILURE_OR_STALE',
        timestamp: now.toISOString(),
        title: 'Scanner Service Stale: Data Collection Halted',
        message: `Provider outage or connection failure detected after ${retriesAttempted} retries. Market for ${context.dateStr} is marked INCOMPLETE; zero synthetic data substituted.`,
        brokerDisclaimer: 'Paper trial notification only. No order was sent to any broker or exchange.',
        read: false,
      });
    } else {
      checkpoint.status = 'degraded';
    }

    writeDaemonCheckpoint(checkpoint);

    return {
      success: false,
      phase: context.phase,
      status: checkpoint.status,
      retriesAttempted,
      error: checkpoint.lastError,
    };
  }
}

/**
 * Dispatches an actionable notification with strict event-ID deduplication.
 */
export function dispatchActionableNotification(
  notification: ActionableNotification
): { delivered: boolean; isDuplicate: boolean } {
  const notifPath = getNotificationsPath();
  let notifications: ActionableNotification[] = [];

  if (fs.existsSync(notifPath)) {
    try {
      notifications = JSON.parse(fs.readFileSync(notifPath, 'utf8'));
    } catch {
      notifications = [];
    }
  }

  // Deduplication Invariant: Zero duplicate alerts for the same event ID
  const existing = notifications.find((n) => n.id === notification.id);
  if (existing) {
    return { delivered: false, isDuplicate: true };
  }

  // Enforce mandatory broker disclaimer
  notification.brokerDisclaimer =
    'Paper trial notification only. No order was sent to any broker or exchange.';

  notifications.push(notification);
  fs.writeFileSync(notifPath, JSON.stringify(notifications, null, 2), 'utf8');

  return { delivered: true, isDuplicate: false };
}

/**
 * Retrieves all stored actionable notifications.
 */
export function getStoredNotifications(): ActionableNotification[] {
  const notifPath = getNotificationsPath();
  if (fs.existsSync(notifPath)) {
    try {
      return JSON.parse(fs.readFileSync(notifPath, 'utf8'));
    } catch {
      return [];
    }
  }
  return [];
}
