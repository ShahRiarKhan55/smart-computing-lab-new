/**
 * Guards the "fill from DOI" endpoint, which makes an outbound Crossref request on behalf of a logged-in user:
 * a short-lived cache (the same DOI is not re-fetched) and a small per-user rate limit. In-memory and
 * per-instance, like the login limiter (documented limitation).
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_LOOKUPS = 30;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;

const buckets = new Map<string, { count: number; windowStart: number }>();
const cache = new Map<string, { at: number; value: unknown }>();

/** Counts one lookup for `userId`; false when the user is over the limit. */
export function allowDoiLookup(userId: string, now = Date.now()): boolean {
  const b = buckets.get(userId);
  if (!b || now - b.windowStart > WINDOW_MS) {
    buckets.set(userId, { count: 1, windowStart: now });
    return true;
  }
  b.count += 1;
  return b.count <= MAX_LOOKUPS;
}

export function getCachedLookup<T>(doiKey: string, now = Date.now()): T | undefined {
  const hit = cache.get(doiKey);
  if (!hit) return undefined;
  if (now - hit.at > CACHE_TTL_MS) {
    cache.delete(doiKey);
    return undefined;
  }
  return hit.value as T;
}

export function setCachedLookup(doiKey: string, value: unknown, now = Date.now()): void {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(doiKey, { at: now, value });
}

export function resetLookupGuard(): void {
  buckets.clear();
  cache.clear();
}

const sweep = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now - b.windowStart > WINDOW_MS) buckets.delete(k);
}, WINDOW_MS);
sweep.unref();
