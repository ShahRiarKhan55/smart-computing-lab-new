/**
 * Bounded per-client limiter for ANONYMOUS Google sign-in initiation (GET /api/auth/google/start).
 *
 * Why it exists: each start persists a (short-lived) session row, so unlimited anonymous starts would be a write/storage
 * flood. The key is `req.ip`, which Express derives from the configured `trust proxy` policy (lib/trustProxy.ts): behind
 * Vercel (`TRUST_PROXY=1`) only the hop Vercel itself appended is trusted, so a client-supplied `X-Forwarded-For` cannot
 * choose its own bucket. IPv6 clients are bucketed by /64 so rotating addresses inside one allocation does not evade it.
 *
 * Honest limits: in-memory and per instance (the same limitation as lib/loginRateLimit.ts); N serverless instances allow
 * up to N times the budget. The global pending-session cap in the route, plus expiry and cleanup, bounds the worst case.
 * Memory is bounded: expired buckets are pruned and, at `maxKeys`, the oldest bucket is evicted.
 */
export interface StartLimiter {
  /** Counts one start for `ip`; returns false when the client is over its budget. */
  take(ip: string): boolean;
}

export function bucketKeyForIp(ip: string): string {
  const v6 = ip.replace(/^::ffff:/i, "");
  if (!v6.includes(":")) return v6; // IPv4 (or an IPv4-mapped address)
  const groups = v6.toLowerCase().split(":");
  if (v6.includes("::")) {
    const [head, tail] = v6.toLowerCase().split("::");
    const h = head ? head.split(":") : [];
    const tl = tail ? tail.split(":") : [];
    const full = [...h, ...Array(Math.max(0, 8 - h.length - tl.length)).fill("0"), ...tl];
    return full.slice(0, 4).join(":");
  }
  return groups.slice(0, 4).join(":");
}

export function createStartLimiter(opts: { max?: number; windowMs?: number; maxKeys?: number; now?: () => number } = {}): StartLimiter {
  const max = opts.max ?? 20;
  const windowMs = opts.windowMs ?? 10 * 60 * 1000;
  const maxKeys = opts.maxKeys ?? 10_000;
  const now = opts.now ?? Date.now;
  const buckets = new Map<string, { count: number; windowStart: number }>();
  return {
    take(ip) {
      const t = now();
      const key = bucketKeyForIp(ip);
      const b = buckets.get(key);
      if (b && t - b.windowStart <= windowMs) {
        b.count += 1;
        return b.count <= max;
      }
      if (!b && buckets.size >= maxKeys) {
        for (const [k, v] of buckets) if (t - v.windowStart > windowMs) buckets.delete(k);
        if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value as string);
      }
      buckets.delete(key); // re-insert so Map order tracks recency of window start
      buckets.set(key, { count: 1, windowStart: t });
      return true;
    },
  };
}
