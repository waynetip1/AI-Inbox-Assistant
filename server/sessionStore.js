// ESM: single shared in-memory store for the whole server.
// Keys are sessionIds; values hold oauth2Client, summaries, stats, usage, etc.
export const sessionStore = Object.create(null);

/**
 * Optional helper to ensure a session object exists.
 * @param {string} sessionId
 * @returns {Record<string, any>}
 */
export function ensureSession(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return {};
  if (!sessionStore[id]) sessionStore[id] = {};
  return sessionStore[id];
}
