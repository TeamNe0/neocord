export interface Cooldowns {
  hit(key: string, durationMs: number): number | null;
  sweep(): void;
  stop(): void;
  readonly size: number;
}

export interface CooldownOptions {
  now?: () => number;
  sweepEvery?: number;
}

export function createCooldowns(options: CooldownOptions = {}): Cooldowns {
  const now = options.now ?? Date.now;
  const entries = new Map<string, number>();

  const sweep = (): void => {
    const current = now();
    for (const [key, expiresAt] of entries) {
      if (expiresAt <= current) entries.delete(key);
    }
  };

  const timer = setInterval(sweep, options.sweepEvery ?? 60_000);
  timer.unref();

  return {
    hit(key, durationMs) {
      const current = now();
      const expiresAt = entries.get(key);
      if (expiresAt !== undefined && expiresAt > current) return expiresAt;
      entries.set(key, current + durationMs);
      return null;
    },
    sweep,
    stop() {
      clearInterval(timer);
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}
