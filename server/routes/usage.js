import express from "express";

/** Date helper: YYYY-MM-DD in America/Chicago */
function todayInCST() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(new Date())
    .reduce((acc, p) => ((acc[p.type] = p.value), acc), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function ensureDaily(session) {
  const limit = Math.max(1, parseInt(process.env.FREE_DAILY_CAP || "30", 10));
  const today = todayInCST();
  if (!session.daily || session.daily.date !== today) {
    session.daily = { date: today, used: 0, limit };
  } else {
    session.daily.limit = limit;
  }
  return session.daily;
}

export default function usageRoute({ sessionStore }) {
  const router = express.Router();

  // GET /api/usage?session=SESSION123
  router.get("/usage", (req, res) => {
    const sessionId = req.query.session?.toString() || "TEST123";
    const session = sessionStore[sessionId];

    // Align with whoami: require a session object AND an oauth2Client
    if (!session || !session.oauth2Client) {
      return res.status(401).json({
        ok: false,
        error: "NO_SESSION",
        session: sessionId,
        message: "Authenticate first at /auth/google?session=YOUR_SESSION_ID",
      });
    }

    const daily = ensureDaily(session);
    res.json({
      ok: true,
      session: sessionId,
      date: daily.date,
      used: daily.used,
      limit: daily.limit,
      remaining: Math.max(0, daily.limit - daily.used),
      note: "Free-tier daily usage in America/Chicago timezone",
    });
  });

  // Dev-only: GET /api/debug/session -> quick visibility into the in-memory store
  router.get("/debug/session", (req, res) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ ok: false, error: "NOT_AVAILABLE" });
    }
    const entries = Object.entries(sessionStore).map(([id, s]) => ({
      id,
      hasClient: !!s?.oauth2Client,
      hasTokens: !!s?.tokens,
      hasDaily: !!s?.daily,
    }));
    res.json({ ok: true, count: entries.length, entries });
  });

  return router;
}
