/**
 * Per-account failed-login tracking. Complements the per-IP rate limiter:
 * a distributed attack rotating IPs against one account still locks out.
 * In-memory by design — this deployment is a single process, and a short
 * window keeps lockout-as-nuisance (someone locking a colleague's account
 * on purpose) to a 15-minute inconvenience.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

const failures = new Map(); // email -> { count, windowStart }

function liveEntry(email) {
  const entry = failures.get(email);
  if (!entry) return null;
  if (Date.now() - entry.windowStart > WINDOW_MS) {
    failures.delete(email);
    return null;
  }
  return entry;
}

/** { locked: false } or { locked: true, minutesLeft } for the login message. */
function status(email) {
  const entry = liveEntry(email);
  if (!entry || entry.count < MAX_FAILURES) return { locked: false };
  const msLeft = entry.windowStart + WINDOW_MS - Date.now();
  return { locked: true, minutesLeft: Math.max(Math.ceil(msLeft / 60000), 1) };
}

function recordFailure(email) {
  const entry = liveEntry(email);
  if (entry) {
    entry.count += 1;
    return;
  }
  // Opportunistic sweep so the map cannot grow without bound.
  if (failures.size > 1000) {
    for (const key of failures.keys()) liveEntry(key);
  }
  failures.set(email, { count: 1, windowStart: Date.now() });
}

function clear(email) {
  failures.delete(email);
}

module.exports = { status, recordFailure, clear, MAX_FAILURES, WINDOW_MS };
