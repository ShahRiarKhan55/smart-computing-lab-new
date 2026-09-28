/**
 * Minimal in-memory brute-force guard for POST /api/auth/login (Phase 25 hardening §4A).
 *
 * Keyed by (client IP, email): a single client repeatedly guessing one account's password is
 * slowed down, without letting a hostile client lock a victim out of their own account by
 * failing logins against it from every other IP. In-memory and per-process by design — this
 * matches the app's current single-process deployment (see docs/architecture); a future
 * multi-instance deployment would need a shared store instead (Phase 26 territory, not a
 * change made here).
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

interface Bucket {
  count: number;
  windowStart: number;
}

const attempts = new Map<string, Bucket>();

function keyFor(ip: string, email: string): string {
  return `${ip}|${email.trim().toLowerCase()}`;
}

function isExpired(bucket: Bucket, now: number): boolean {
  return now - bucket.windowStart > WINDOW_MS;
}

/** True when this (ip, email) pair has failed too many times within the current window. */
export function isLoginRateLimited(ip: string, email: string): boolean {
  const key = keyFor(ip, email);
  const bucket = attempts.get(key);
  if (!bucket) return false;
  if (isExpired(bucket, Date.now())) {
    attempts.delete(key);
    return false;
  }
  return bucket.count >= MAX_ATTEMPTS;
}

/** Call after a failed login (unknown email OR wrong password — the caller doesn't distinguish). */
export function recordFailedLogin(ip: string, email: string): void {
  const key = keyFor(ip, email);
  const now = Date.now();
  const bucket = attempts.get(key);
  if (!bucket || isExpired(bucket, now)) {
    attempts.set(key, { count: 1, windowStart: now });
    return;
  }
  bucket.count += 1;
}

/** Call after a successful login, so a legitimate user's next mistyped password starts fresh. */
export function clearLoginAttempts(ip: string, email: string): void {
  attempts.delete(keyFor(ip, email));
}

// Opportunistic cleanup so long-running processes don't accumulate one entry per distinct
// (ip, email) pair forever. Unref'd so it never keeps the process alive on its own (tests that
// import this module and exit promptly are unaffected).
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of attempts) {
    if (isExpired(bucket, now)) attempts.delete(key);
  }
}, WINDOW_MS);
sweep.unref();
