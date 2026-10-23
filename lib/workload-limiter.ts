/**
 * Workload Concurrency Limiter (Month 10 M10-05)
 *
 * Implements bounded concurrency control and request queuing for heavy computational
 * workloads (batch ML scans, forward observation updates, deep backtests).
 *
 * Protects node event loop and memory from spike saturation under concurrent pilot usage.
 */

export interface WorkloadLimiterOptions {
  maxConcurrent: number;
  maxQueueSize: number;
  queueTimeoutMs: number;
}

export interface WorkloadStats {
  activeJobs: number;
  queuedJobs: number;
  maxConcurrent: number;
  maxQueueSize: number;
  totalAccepted: number;
  totalRejected: number;
  totalCompleted: number;
  totalTimedOut: number;
}

export class WorkloadLimiter {
  private activeCount: number = 0;
  private queue: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
    enqueuedAt: number;
  }> = [];

  private stats: {
    totalAccepted: number;
    totalRejected: number;
    totalCompleted: number;
    totalTimedOut: number;
  } = {
    totalAccepted: 0,
    totalRejected: 0,
    totalCompleted: 0,
    totalTimedOut: 0,
  };

  private readonly options: WorkloadLimiterOptions;

  constructor(options: Partial<WorkloadLimiterOptions> = {}) {
    this.options = {
      maxConcurrent: options.maxConcurrent ?? 4,
      maxQueueSize: options.maxQueueSize ?? 20,
      queueTimeoutMs: options.queueTimeoutMs ?? 10000,
    };
  }

  /**
   * Acquire execution slot or enqueue.
   * Throws Error with status 429/503 if queue is full or wait times out.
   */
  async acquire(): Promise<() => void> {
    if (this.activeCount < this.options.maxConcurrent) {
      this.activeCount++;
      this.stats.totalAccepted++;
      return this.createReleaseFn();
    }

    if (this.queue.length >= this.options.maxQueueSize) {
      this.stats.totalRejected++;
      const err = new Error('Server workload capacity saturated. Please retry shortly.');
      (err as any).statusCode = 503;
      (err as any).code = 'WORKLOAD_SATURATED';
      throw err;
    }

    return new Promise<() => void>((resolve, reject) => {
      const enqueuedAt = Date.now();
      const timer = setTimeout(() => {
        // Find and remove from queue
        const idx = this.queue.findIndex((item) => item.timer === timer);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
          this.stats.totalTimedOut++;
          const timeoutErr = new Error('Workload queue wait timeout exceeded.');
          (timeoutErr as any).statusCode = 429;
          (timeoutErr as any).code = 'WORKLOAD_TIMEOUT';
          reject(timeoutErr);
        }
      }, this.options.queueTimeoutMs);

      this.queue.push({
        resolve: () => {
          clearTimeout(timer);
          this.stats.totalAccepted++;
          resolve(this.createReleaseFn());
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        timer,
        enqueuedAt,
      });
    });
  }

  /**
   * Run an async task under concurrency protection.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private createReleaseFn(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeCount = Math.max(0, this.activeCount - 1);
      this.stats.totalCompleted++;

      if (this.queue.length > 0 && this.activeCount < this.options.maxConcurrent) {
        const next = this.queue.shift();
        if (next) {
          this.activeCount++;
          next.resolve();
        }
      }
    };
  }

  getStats(): WorkloadStats {
    return {
      activeJobs: this.activeCount,
      queuedJobs: this.queue.length,
      maxConcurrent: this.options.maxConcurrent,
      maxQueueSize: this.options.maxQueueSize,
      ...this.stats,
    };
  }

  reset(): void {
    for (const item of this.queue) {
      clearTimeout(item.timer);
    }
    this.queue = [];
    this.activeCount = 0;
    this.stats = {
      totalAccepted: 0,
      totalRejected: 0,
      totalCompleted: 0,
      totalTimedOut: 0,
    };
  }
}

// Global default limiters for compute-heavy paths
export const globalScanWorkloadLimiter = new WorkloadLimiter({
  maxConcurrent: 3,
  maxQueueSize: 15,
  queueTimeoutMs: 8000,
});

export const globalBacktestWorkloadLimiter = new WorkloadLimiter({
  maxConcurrent: 2,
  maxQueueSize: 10,
  queueTimeoutMs: 12000,
});
