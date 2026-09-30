/**
 * A sliding window count of attempts per key, in memory. Enough to stop guessing passwords
 * from one address or against one username on a single server. ponytail: per process; with
 * more than one server the limits need a shared store (a table, or Redis).
 */
export class Limiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const since = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (list.length === 0) this.hits.delete(key);
    else this.hits.set(key, list);
    return list;
  }

  /** Whether another attempt is allowed now. */
  allowed(key: string): boolean {
    return this.recent(key).length < this.max;
  }

  record(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    this.hits.set(key, list);
    // Keep the map from growing without end under a flood of distinct keys.
    if (this.hits.size > 50_000)
      for (const k of this.hits.keys()) if (!this.recent(k).length) this.hits.delete(k);
  }

  clear(key: string): void {
    this.hits.delete(key);
  }

  reset(): void {
    this.hits.clear();
  }
}
