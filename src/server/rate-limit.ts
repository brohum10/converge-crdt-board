export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly tokensPerSecond: number,
    now = Date.now(),
  ) {
    this.tokens = capacity;
    this.lastRefill = now;
  }

  take(cost: number, now = Date.now()): boolean {
    const elapsedSeconds = Math.max(0, now - this.lastRefill) / 1_000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.tokensPerSecond);
    this.lastRefill = Math.max(this.lastRefill, now);
    if (cost > this.tokens) return false;
    this.tokens -= cost;
    return true;
  }
}
