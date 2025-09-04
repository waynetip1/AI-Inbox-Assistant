// server/routes/dev.js (ESM)
import express from "express";
import { sessionStore } from "../sessionStore.js";

const router = express.Router();

function isLocal(req) {
  const ip = req.ip || req.connection?.remoteAddress || "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

/**
 * POST /dev/seed-usage
 * Body (optional):
 * {
 *   "session": "LIVE123",
 *   "items": [
 *     { "date": "2025-08-24", "requests": 2, "promptTokens": 800, "completionTokens": 300 },
 *     ...
 *   ]
 * }
 * If no body/items are provided, seeds a 3-row default.
 */
router.post("/dev/seed-usage", (req, res) => {
  if (process.env.DEV_ENABLE_SEED !== "1") return res.status(404).send("Disabled");
  if (!isLocal(req)) return res.status(403).send("Forbidden");

  const body = req.body || {};
  const session = String(body.session || "LIVE123").trim();
  if (!session) return res.status(400).json({ ok: false, error: "Missing 'session'" });

  let daily = [];
  if (Array.isArray(body.items) && body.items.length) {
    daily = body.items.map((x) => ({
      date: String(x.date).slice(0, 10),
      requests: Number(x.requests) || 0,
      promptTokens: Number(x.promptTokens) || 0,
      completionTokens: Number(x.completionTokens) || 0,
    }));
  } else {
    const today = new Date();
    const d = (n) => {
      const x = new Date(today);
      x.setDate(x.getDate() - n);
      return x.toISOString().slice(0, 10);
    };
    daily = [
      { date: d(6), requests: 3, promptTokens: 1200, completionTokens: 600 },
      { date: d(3), requests: 4, promptTokens: 1800, completionTokens: 900 },
      { date: d(0), requests: 2, promptTokens: 800,  completionTokens: 300 },
    ];
  }

  sessionStore[session] = sessionStore[session] || {};
  sessionStore[session].usage = { daily };

  return res.json({ ok: true, session, count: daily.length });
});

export default router;
