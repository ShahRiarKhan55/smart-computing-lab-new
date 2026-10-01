/**
 * Minimal in-memory rate guard for the public invitation-token endpoints (info lookup + accept),
 * same shape and same documented single-process/Vercel-instance caveat as loginRateLimit.ts.
 *
 * The 256-bit token itself is already infeasible to brute-force (see lib/invitationToken.ts) —
 * this exists as defense-in-depth against sheer request volume (enumeration noise, accidental
 * retry storms), not because the token is realistically guessable.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 20;

interface Bucket {
  count: number;
  windowStart: number;
}

const attempts = new Map<string, Bucket>();

function isExpired(bucket: Bucket, now: number): boolean {
  return now - bucket.windowStart > WINDOW_MS;
}

export function isInvitationRateLimited(ip: string): boolean {
  const bucket = attempts.get(ip);
  if (!bucket) return false;
  if (isExpired(bucket, Date.now())) {
    attempts.delete(ip);
    return false;
  }
  return bucket.count >= MAX_ATTEMPTS;
}

export function recordInvitationAttempt(ip: string): void {
  const now = Date.now();
  const bucket = attempts.get(ip);
  if (!bucket || isExpired(bucket, now)) {
    attempts.set(ip, { count: 1, windowStart: now });
    return;
  }
  bucket.count += 1;
}

const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of attempts) {
    if (isExpired(bucket, now)) attempts.delete(key);
  }
}, WINDOW_MS);
sweep.unref();
