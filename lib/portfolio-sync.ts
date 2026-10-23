import { validateProfileUpdates } from './profile-validation';

export type PortfolioPatch = Partial<{
  holdings: Record<string, { ticker: string; quantity: number; buyPrice: number }>;
  portfolioCash: number;
  portfolioTransactions: any[];
  portfolioRiskRules: Record<string, { stopLoss: number | null; takeProfit: number | null; autoExit: boolean }>;
  portfolioEquityHistory: { time: string; value: number }[];
}>;
type Operation = { operationId: string; expectedVersion: number; updates: PortfolioPatch };
export type SaveStatus = 'loading' | 'saved' | 'saving' | 'pending' | 'error' | 'conflict' | 'signed-out';
export type PortfolioSyncState = { status: SaveStatus; message: string; profile: PortfolioPatch | null; pending: boolean };
type Stored = { version: number; profile: PortfolioPatch; operations: Operation[]; blocked?: boolean; recovery?: PortfolioPatch };
const fields = ['holdings', 'portfolioCash', 'portfolioTransactions', 'portfolioRiskRules', 'portfolioEquityHistory'];

function cleanPatch(value: any): PortfolioPatch {
  value = JSON.parse(JSON.stringify(value));
  const result = validateProfileUpdates(value);
  if (!result.valid || Object.keys(value).some(key => !fields.includes(key))) throw new Error('Invalid saved portfolio data.');
  return result.cleanUpdates;
}
function portfolio(data: any): PortfolioPatch {
  return Object.fromEntries(fields.filter(key => key in data).map(key => [key, data[key]]));
}

/** One instance per authenticated browser tab. Session storage survives reloads without sharing another tab's queue. */
export class PortfolioSync {
  private stored: Stored | null = null;
  private draft: PortfolioPatch | null = null;
  private active = true;
  private busy = false;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private storageBroken = false;
  state: PortfolioSyncState = { status: 'loading', message: 'Loading saved portfolio…', profile: null, pending: false };

  constructor(readonly accountEmail: string, private storage: Pick<Storage, 'getItem' | 'setItem'>,
    private changed: (state: PortfolioSyncState) => void, private transport: typeof fetch = fetch,
    private id: () => string = () => crypto.randomUUID(), private legacy?: () => PortfolioPatch | null) {}

  get key() { return `axion_${this.accountEmail}_portfolio_sync_v1`; }

  private publish(status: SaveStatus, message: string) {
    if (!this.active) return;
    const profile = this.stored ? Object.assign({}, this.stored.profile, this.stored.recovery, ...this.stored.operations.map(op => op.updates), this.draft) : null;
    this.state = { status, message, profile, pending: Boolean(this.draft || this.stored?.operations.length || this.stored?.recovery) };
    this.changed(this.state);
  }

  private persist() {
    try {
      this.storage.setItem(this.key, JSON.stringify(this.stored));
      this.storageBroken = false;
      return true;
    } catch {
      this.storageBroken = true;
      this.publish('error', 'Browser storage is unavailable. Keep this tab open and download pending changes before leaving.');
      return false;
    }
  }

  private async request(init?: RequestInit) {
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await this.transport('/api/user/data', { ...init, headers: { ...init?.headers, 'X-Portfolio-Account': this.accountEmail }, cache: 'no-store', signal: controller.signal });
      // Proxies and edge layers can return HTML/empty error bodies; the status code must still drive recovery.
      let data: any = null;
      try { data = await response.json(); } catch { if (response.ok) throw new Error('Invalid response body'); }
      return { response, data };
    } finally {
      clearTimeout(timeout);
      if (this.controller === controller) this.controller = null;
    }
  }

  async start() {
    try {
      const raw = this.storage.getItem(this.key);
      if (raw) {
        const saved = JSON.parse(raw);
        if (!saved || !Number.isSafeInteger(saved.version) || saved.version < 0 || !Array.isArray(saved.operations) || saved.operations.length > 100) throw new Error();
        saved.profile = cleanPatch(saved.profile);
        if (saved.recovery) saved.recovery = cleanPatch(saved.recovery);
        saved.operations = saved.operations.map((op: Operation, index: number) => {
          if (!op || typeof op.operationId !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(op.operationId)
            || op.expectedVersion !== saved.version + index) throw new Error();
          return { operationId: op.operationId, expectedVersion: op.expectedVersion, updates: cleanPatch(op.updates) };
        });
        this.stored = saved;
      }
    } catch {
      this.storageBroken = true;
      this.publish('error', 'Saved browser data could not be read. Download it before choosing Use account data.');
      return;
    }
    await this.load();
  }

  private async load() {
    if (!this.active || this.busy) return;
    this.busy = true;
    try {
      const { response, data } = await this.request();
      if (!this.active) return;
      if (!response.ok || !data?.success || !Number.isSafeInteger(data.portfolioVersion)) {
        this.publish('error', response.status === 401 ? 'Sign in again to save your pending changes.' : 'Account unavailable. Your pending changes are preserved.');
        return;
      }
      const profile = cleanPatch(portfolio(data));
      if (!this.stored) {
        let legacy: PortfolioPatch | null = null;
        try { const raw = this.legacy?.(); if (raw) legacy = cleanPatch(raw); }
        catch { this.storageBroken = true; this.publish('error', 'Old browser data could not be read. Download it before choosing Use account data.'); return; }
        const differs = legacy && Object.keys(legacy).some(key => JSON.stringify((legacy as any)[key]) !== JSON.stringify((profile as any)[key]));
        this.stored = { version: data.portfolioVersion, profile, operations: [], ...(differs ? { recovery: legacy!, blocked: true } : {}) };
      } else if (!this.stored.operations.length && !this.stored.recovery) this.stored = { version: data.portfolioVersion, profile, operations: [] };
      // A pending request keeps its original version and ID even if the server has advanced.
      if (!this.persist()) return;
      this.publish(this.stored.blocked ? 'conflict' : this.stored.operations.length ? 'pending' : 'saved',
        this.stored.recovery ? 'Your old browser portfolio differs from your account. Download it before choosing Use account data.' : this.stored.blocked ? 'Saving paused. Download pending changes or use account data.' : this.stored.operations.length ? 'Changes pending' : 'Saved');
    } catch {
      this.publish('pending', 'Offline or account unavailable—changes pending.');
    } finally {
      this.busy = false;
    }
    if (this.stored && !this.stored.blocked && !this.storageBroken) void this.pump();
  }

  /** Synchronous edits from one action are sealed into one atomic request at the end of the event. */
  enqueue(updates: PortfolioPatch): boolean {
    if (!this.active || !this.stored || this.storageBroken || this.stored.blocked || this.state.status === 'loading') {
      this.publish(this.stored?.blocked ? 'conflict' : 'error', 'Saving is paused. Recover your pending changes before editing.');
      return false;
    }
    try { updates = cleanPatch(updates); }
    catch { this.draft = null; this.publish('error', 'Invalid portfolio change. Nothing was saved.'); return false; }
    if (this.stored.operations.length >= 100) { this.publish('error', 'Too many pending saves. Reconnect before making more edits.'); return false; }
    const scheduled = this.draft !== null;
    this.draft = { ...this.draft, ...updates };
    this.publish('pending', 'Changes pending');
    if (!scheduled) queueMicrotask(() => this.seal());
    return true;
  }

  private seal() {
    if (!this.draft || !this.stored) return;
    this.stored.operations.push({ operationId: this.id(), expectedVersion: this.stored.version + this.stored.operations.length, updates: this.draft });
    this.draft = null;
    if (this.persist() && this.active) void this.pump();
  }

  private async pump() {
    if (!this.active || this.busy || this.timer || this.storageBroken || this.stored?.blocked) return;
    const operation = this.stored?.operations[0];
    if (!operation) return;
    this.busy = true;
    this.publish('saving', 'Saving…');
    try {
      const { response, data } = await this.request({ method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...operation, accountEmail: this.accountEmail }) });
      if (!this.active) return;
      if (!response.ok) {
        if (response.status === 429) {
          const header = Number(response.headers?.get?.('Retry-After') ?? data?.retryAfter);
          const err: any = new Error('Rate limited');
          err.retryAfterMs = Number.isFinite(header) && header > 0 ? Math.min(header, 300) * 1000 : null;
          throw err;
        }
        if (response.status >= 500) {
          const err: any = new Error('Temporary failure');
          err.status = response.status;
          throw err;
        }
        this.stored!.blocked = true;
        this.persist();
        this.publish(response.status === 409 ? 'conflict' : 'error', response.status === 409
          ? 'Another tab or device changed this portfolio. Download your pending changes before using account data.'
          : response.status === 401 || response.status === 403 ? 'Sign in to the original account, then retry. Changes remain pending.'
          : response.status === 428 ? 'The server needs a versioned save. Download your pending changes, then reload the app.'
          : 'Save rejected. Download your pending changes before using account data.');
        return;
      }
      if (!data?.success || data.operationId !== operation.operationId || data.portfolioVersion !== operation.expectedVersion + 1) throw new Error('Invalid acknowledgement');
      this.stored!.profile = { ...this.stored!.profile, ...operation.updates };
      this.stored!.version = data.portfolioVersion;
      this.stored!.operations.shift();
      this.attempts = 0;
      if (!this.persist()) return;
      this.publish(this.stored!.operations.length || this.draft ? 'pending' : 'saved', this.stored!.operations.length || this.draft ? 'Changes pending' : 'Saved');
    } catch (error: any) {
      if (!this.active) return;
      const retryAfterMs: number | null = error?.retryAfterMs ?? null;
      const databaseDown = error?.status === 503;
      if (this.attempts < 3) {
        const delay = retryAfterMs ?? 1000 * 2 ** this.attempts;
        this.attempts++;
        this.publish('pending', retryAfterMs
          ? `Save limit reached—retrying in ${Math.ceil(delay / 1000)}s. Changes pending.`
          : databaseDown ? 'Account database unavailable—changes pending, retrying.'
          : 'Offline or save unavailable—changes pending.');
        this.timer = setTimeout(() => { this.timer = null; void this.pump(); }, delay);
      } else this.publish('error', databaseDown
        ? 'Account database still unavailable after three retries. Changes are retained; retry later.'
        : 'Save failed after three retries. Changes are retained; retry when connected.');
    } finally {
      this.busy = false;
    }
    if (this.active && this.state.status !== 'error') void this.pump();
  }

  retry() {
    if (!this.active || this.busy) return;
    if (this.stored?.recovery) { this.publish('conflict', 'Download your old browser portfolio before choosing Use account data.'); return; }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.attempts = 0;
    // Retrying always uses the original version; it can never overwrite a conflict.
    if (this.stored) {
      this.stored.blocked = false;
      if (this.persist()) void (this.stored.operations.length ? this.pump() : this.load());
    } else if (!this.storageBroken) void this.load();
  }

  async useAccountData() {
    if (!this.active || this.busy) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // Keep pending data intact until a fresh read succeeds.
    this.busy = true;
    try {
      const { response, data } = await this.request();
      if (!this.active) return;
      if (!response.ok || !data?.success || !Number.isSafeInteger(data.portfolioVersion)) throw new Error();
      const next = { version: data.portfolioVersion, profile: cleanPatch(portfolio(data)), operations: [] };
      this.storage.setItem(this.key, JSON.stringify(next));
      this.stored = next;
      this.draft = null;
      this.storageBroken = false;
      this.publish('saved', 'Saved account data loaded');
    } catch { this.publish('error', 'Could not load account data. Your pending changes are preserved.'); }
    finally { this.busy = false; }
  }

  exportPending() {
    let original: string | null = null;
    try { original = this.storage.getItem(this.key); } catch { /* In-memory data is still exportable. */ }
    return JSON.stringify({ accountEmail: this.accountEmail, saved: this.stored, draft: this.draft, original }, null, 2);
  }

  dispose() {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.controller?.abort();
    this.seal();
  }
}
