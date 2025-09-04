// server/lib/inflight.js
/**
 * Minimal in-flight request coalescer.
 * For any given key, at most one function `fn` runs at a time.
 * All concurrent callers receive the same promise.
 */
const inflight = new Map();

/**
 * Run or join in-flight work for a given key.
 * @template T
 * @param {string} key - stable identifier for the work (e.g., "stats:<session>:<range>:exact=0")
 * @param {() => Promise<T>} fn - work to run if not already running
 * @returns {Promise<T>}
 */
export function coalesce(key, fn) {
  const entry = inflight.get(key);
  if (entry) return entry;

  const p = (async () => {
    try {
      return await fn();
    } finally {
      // ensure cleanup even on throw
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}

/** True if there is currently an in-flight promise for this exact key. */
export function isInFlight(key) {
  return inflight.has(key);
}

/**
 * True if ANY in-flight key starts with the given prefix.
 * Useful when callers don’t know the full key (e.g., exact vs approx variants).
 * @param {string} prefix
 */
export function isInFlightPrefix(prefix) {
  for (const k of inflight.keys()) {
    if (k.startsWith(prefix)) return true;
  }
  return false;
}
