// client/src/lib/api.js
// Unified fetch with auto-reauth on 401 NO_SESSION.
// Assumes the backend base URL is in VITE_API_BASE_URL or http://localhost:3000.

export const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

/** Read the current session from the URL each time (source of truth). */
export function getSessionFromUrl() {
  const sp = new URLSearchParams(window.location.search);
  return sp.get("session") || "TEST123";
}

/**
 * apiFetch(url, options)
 * - If response is 401 and body contains error "NO_SESSION", we redirect to OAuth.
 * - Otherwise returns the Response as-is.
 */
export async function apiFetch(input, init) {
  const res = await fetch(input, init);

  if (res.status === 401) {
    // try to read JSON body if available, else fall back to redirect anyway
    let payload = {};
    try {
      if ((res.headers.get("content-type") || "").includes("application/json")) {
        payload = await res.clone().json();
      }
    } catch {
      // ignore
    }
    if (payload?.error === "NO_SESSION") {
      const session = getSessionFromUrl();
      // Redirect to Google OAuth for the current session ID
      window.location.href = `${API_BASE}/auth/google?session=${encodeURIComponent(
        session
      )}`;
      // Return a never-resolving promise to halt further processing in callers
      return new Promise(() => {});
    }
  }

  return res;
}
