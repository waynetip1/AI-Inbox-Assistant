// client/src/api.js
// Single-flight (deduped) fetch for identical METHOD+URL requests.
// Also canonicalizes URLs (sorts query params) so keys are stable.

export const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

const inflight = new Map();      // key -> Promise<Response>
const controllers = new Map();   // key -> AbortController

function normalizeUrlString(u) {
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const url = new URL(u, base);
    // sort query params to canonicalize
    try { url.searchParams.sort(); } catch {}
    return url.toString();
  } catch {
    return String(u);
  }
}

function keyFor(url, init) {
  const method = (init?.method || "GET").toUpperCase();
  const href = typeof url === "string" ? normalizeUrlString(url) : normalizeUrlString(String(url));
  return `${method} ${href}`;
}

/** Abort all in-flight whose key starts with prefix (optional utility). */
export function abortApi(prefix) {
  for (const [k, c] of controllers.entries()) {
    if (k.startsWith(prefix)) {
      try { c.abort(); } catch {}
      controllers.delete(k);
      inflight.delete(k);
    }
  }
}

/** Dedupe-aware fetch. Returns a Response *clone* for each caller. */
export async function apiFetch(url, init = {}) {
  const key = keyFor(url, init);

  const existing = inflight.get(key);
  if (existing) {
    const shared = await existing.catch((e) => { throw e; });
    return shared.clone();
  }

  const controller = new AbortController();
  controllers.set(key, controller);

  const p = (async () => {
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      return res;
    } finally {
      inflight.delete(key);
      controllers.delete(key);
    }
  })();

  inflight.set(key, p);
  const res = await p;
  return res.clone();
}
