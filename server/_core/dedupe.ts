const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 5000;

export class TtlDedupeSet {
  private readonly entries = new Map<string, number>();

  constructor(
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES
  ) {}

  has(key: string, now = Date.now()): boolean {
    this.prune(now);

    const expiresAt = this.entries.get(key);
    if (!expiresAt) {
      return false;
    }

    if (expiresAt <= now) {
      this.entries.delete(key);
      return false;
    }

    return true;
  }

  add(key: string, now = Date.now()): void {
    this.prune(now);

    this.entries.delete(key);
    this.entries.set(key, now + this.ttlMs);

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) {
        break;
      }
      this.entries.delete(oldestKey);
    }
  }

  seen(key: string, now = Date.now()): boolean {
    if (this.has(key, now)) {
      return true;
    }

    this.add(key, now);
    return false;
  }

  clear(): void {
    this.entries.clear();
  }

  private prune(now: number): void {
    this.entries.forEach((expiresAt, key) => {
      if (expiresAt <= now) {
        this.entries.delete(key);
      }
    });
  }
}

export { DEFAULT_MAX_ENTRIES, DEFAULT_TTL_MS };
