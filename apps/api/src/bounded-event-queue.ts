/** Single-consumer bounded mailbox used by each SSE connection. Producers
 * never await a slow browser; when capacity is exhausted the caller disconnects
 * that client without affecting other tenants or streams. */
export class BoundedEventQueue<T> {
  private readonly items: T[] = [];
  private waiter: ((value: T | null) => void) | null = null;
  private closed = false;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Queue capacity must be a positive integer');
  }

  push(value: T): boolean {
    if (this.closed) return false;
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter(value);
      return true;
    }
    if (this.items.length >= this.capacity) return false;
    this.items.push(value);
    return true;
  }

  next(timeoutMs: number): Promise<T | null> {
    if (this.items.length > 0) return Promise.resolve(this.items.shift()!);
    if (this.closed) return Promise.resolve(null);
    if (this.waiter) throw new Error('BoundedEventQueue supports one consumer');
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.waiter === finish) this.waiter = null;
        resolve(null);
      }, timeoutMs);
      const finish = (value: T | null) => {
        clearTimeout(timeout);
        resolve(value);
      };
      this.waiter = finish;
    });
  }

  close(): void {
    this.closed = true;
    this.items.length = 0;
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.(null);
  }
}
