// server/routes/debug.js
import express from "express";

/**
 * Dev-only debug routes to help with local testing.
 * - ensure-session: creates an empty session object so routes that only check for
 *   session existence (e.g., compose) will work without OAuth.
 * - session: inspect basic session fields.
 */
export default function debugRoute({ sessionStore }) {
  const router = express.Router();

  // POST /api/debug/ensure-session?session=TEST123
  router.post("/ensure-session", (req, res) => {
    const sessionId = (req.query.session || "TEST123").toString();
    if (!sessionStore[sessionId]) {
      sessionStore[sessionId] = {};
    }
    return res.json({ ok: true, sessionId, created: true });
  });

  // GET /api/debug/session?session=TEST123
  router.get("/session", (req, res) => {
    const sessionId = (req.query.session || "TEST123").toString();
    const s = sessionStore[sessionId];
    return res.json({
      ok: true,
      sessionId,
      exists: !!s,
      hasOauth: !!s?.oauth2Client,
      keys: s ? Object.keys(s) : [],
      daily: s?.daily || null,
    });
  });

  return router;
}
