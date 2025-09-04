// server/middleware/ensureSession.js
import { rehydrateSession } from "../persist.js";

/**
 * Ensures a session exists for any /api/* request.
 * If missing in memory, try to rehydrate from disk.
 */
export default function ensureSession({ sessionStore }) {
  return async function (req, res, next) {
    const sessionId =
      (req.query?.session || req.body?.session || "").toString().trim();

    if (!sessionId) {
      return res.status(401).json({
        ok: false,
        error: "NO_SESSION",
        message: "Authenticate first at /auth/google?session=YOUR_SESSION_ID",
      });
    }

    // If it's already in memory, continue
    if (sessionStore[sessionId]?.oauth2Client) return next();

    // Try to rehydrate from disk
    try {
      const restored = await rehydrateSession(sessionStore, sessionId);
      if (restored?.oauth2Client) return next();
    } catch {
      // swallow and fall through to 401
    }

    return res.status(401).json({
      ok: false,
      error: "NO_SESSION",
      message: "Authenticate first at /auth/google?session=YOUR_SESSION_ID",
    });
  };
}
