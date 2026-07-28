export interface ForwardQueueOptions<T> {
  capacity: number;
  perKeyCapacity: number;
  concurrency: number;
  timeoutMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  keyOf: (value: T) => string;
  classifyError?: (error: unknown) => { category: string; retryable: boolean };
  random?: () => number;
  hooks?: {
    state?: (state: ForwardQueueState) => void;
    accepted?: () => void;
    succeeded?: (latencyMs: number) => void;
    retry?: (category: string) => void;
    dropped?: (reason: 'queue_full' | 'per_key_limit' | 'shutting_down') => void;
    failed?: (category: string, error: unknown) => void;
  };
}

export interface ForwardQueueState {
  accepting: boolean;
  depth: number;
  capacity: number;
  inFlight: number;
}

interface WorkItem<T> {
  value: T;
  key: string;
  enqueuedAt: number;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Bounded async boundary for the ingest -> API sink.
 *
 * The queue bounds total memory, the per-key cap prevents one device from
 * monopolising it, and concurrency/timeouts bound downstream resource use.
 * Retries stay inside an in-flight slot, so retry storms cannot grow the queue.
 */
export class ForwardQueue<T> {
  private readonly pending: WorkItem<T>[] = [];
  private readonly perKey = new Map<string, number>();
  private readonly waiters = new Set<(drained: boolean) => void>();
  private accepting = true;
  private inFlight = 0;

  constructor(
    private readonly send: (value: T, signal: AbortSignal) => Promise<void>,
    private readonly options: ForwardQueueOptions<T>,
  ) {
    for (const [name, value] of Object.entries({
      capacity: options.capacity,
      perKeyCapacity: options.perKeyCapacity,
      concurrency: options.concurrency,
      timeoutMs: options.timeoutMs,
      maxAttempts: options.maxAttempts,
      retryBaseMs: options.retryBaseMs,
    })) {
      if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number`);
    }
    this.emitState();
  }

  enqueue(value: T): boolean {
    if (!this.accepting) return this.drop('shutting_down');
    if (this.pending.length + this.inFlight >= this.options.capacity) return this.drop('queue_full');

    const key = this.options.keyOf(value);
    if ((this.perKey.get(key) ?? 0) >= this.options.perKeyCapacity) return this.drop('per_key_limit');

    this.pending.push({ value, key, enqueuedAt: Date.now() });
    this.perKey.set(key, (this.perKey.get(key) ?? 0) + 1);
    this.options.hooks?.accepted?.();
    this.emitState();
    this.pump();
    return true;
  }

  snapshot(): ForwardQueueState {
    return {
      accepting: this.accepting,
      depth: this.pending.length,
      capacity: this.options.capacity,
      inFlight: this.inFlight,
    };
  }

  async closeAndDrain(timeoutMs: number): Promise<boolean> {
    this.accepting = false;
    this.emitState();
    if (this.isDrained()) return true;

    return new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (drained: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.waiters.delete(finish);
        resolve(drained);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      this.waiters.add(finish);
    });
  }

  private drop(reason: 'queue_full' | 'per_key_limit' | 'shutting_down'): false {
    this.options.hooks?.dropped?.(reason);
    return false;
  }

  private pump(): void {
    while (this.inFlight < this.options.concurrency && this.pending.length > 0) {
      const item = this.pending.shift()!;
      this.inFlight += 1;
      this.emitState();
      void this.run(item).finally(() => {
        this.inFlight -= 1;
        const remaining = (this.perKey.get(item.key) ?? 1) - 1;
        if (remaining <= 0) this.perKey.delete(item.key);
        else this.perKey.set(item.key, remaining);
        this.emitState();
        this.resolveWaitersIfDrained();
        this.pump();
      });
    }
  }

  private async run(item: WorkItem<T>): Promise<void> {
    const random = this.options.random ?? Math.random;
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error('sink_timeout')), this.options.timeoutMs);
      try {
        await this.send(item.value, controller.signal);
        this.options.hooks?.succeeded?.(Date.now() - item.enqueuedAt);
        return;
      } catch (error) {
        const classified = this.options.classifyError?.(error) ?? { category: 'unknown', retryable: true };
        if (!classified.retryable || attempt === this.options.maxAttempts) {
          this.options.hooks?.failed?.(classified.category, error);
          return;
        }
        this.options.hooks?.retry?.(classified.category);
        const exponential = this.options.retryBaseMs * 2 ** (attempt - 1);
        await delay(Math.round(exponential * (0.5 + random())));
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  private isDrained(): boolean {
    return this.pending.length === 0 && this.inFlight === 0;
  }

  private resolveWaitersIfDrained(): void {
    if (!this.isDrained()) return;
    for (const waiter of [...this.waiters]) waiter(true);
  }

  private emitState(): void {
    this.options.hooks?.state?.(this.snapshot());
  }
}
