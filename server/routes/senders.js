// server/routes/senders.js
import express from "express";
import { listMessages, getMessageFrom, RateLimitedError } from "../lib/gmailSafe.js";
import { coalesce, isInFlightPrefix } from "../lib/inflight.js";

/** Factory route: expects { sessionStore } injected from index.js */
export default function sendersRouteFactory({ sessionStore }) {
  const router = express.Router();

  const rangeToWin = (r) =>
    ["1d", "7d", "30d", "60d", "90d"].includes(r) ? `newer_than:${r}` : "newer_than:7d";
  const joinQ = (base, win) => [base, win].join(" ");

  function parseSender(v) {
    if (!v) return "Unknown";
    const m = v.match(/^(.*?)(<.*?>)?$/);
    if (!m) return v.trim();
    return (m[1] || v).trim() || v.trim();
  }

  // GET /api/senders?session=...&range=1d&limit=8&sample=200
  router.get("/senders", async (req, res) => {
    const session = String(req.query.session || "");
    const range = String(req.query.range || "7d");
    const limit = Math.max(1, Math.min(20, Number(req.query.limit || 8)));
    const sample = Math.max(20, Math.min(200, Number(req.query.sample || 200)));

    if (!session || !sessionStore[session]?.oauth2Client) {
      return res.status(401).json({ ok: false, error: "NO_SESSION" });
    }
    const oauth2 = sessionStore[session].oauth2Client;

    // per-session cache
    sessionStore[session].sendersCache = sessionStore[session].sendersCache || {};
    const cacheKey = `${range}|${limit}|${sample}`;
    const cached = sessionStore[session].sendersCache[cacheKey];

    // NEW: If ANY stats job (approx or exact) is running for this (session, range), defer.
    // stats coalesce keys look like: stats:<session>:<range>:exact=0|1
    const statsPrefix = `stats:${session}:${range}`;
    if (isInFlightPrefix(statsPrefix)) {
      if (cached) {
        return res.json({
          ...cached,
          fromCache: true,
          deferred: true,
          note: "Deferred while snapshot was building.",
        });
      }
      return res.json({
        ok: true,
        senders: [],
        sampled: 0,
        scanned: 0,
        limited: true,
        deferred: true,
        note: "Deferred until snapshot finishes to keep the app fast.",
      });
    }

    try {
      const out = await coalesce(`senders:${session}:${cacheKey}`, async () => {
        const win = rangeToWin(range);
        const q = joinQ("in:inbox", win);

        // List small set of ids (cheap, returns resultSizeEstimate + ids)
        const list = await listMessages(oauth2, session, { q, maxResults: sample });
        const ids = (list.messages || []).map((m) => m.id);

        // Keep QPM low: hard cap actual message.get calls
        const scanN = Math.min(ids.length, Math.min(40, limit * 8));

        const counts = new Map();
        for (let i = 0; i < scanN; i++) {
          const from = await getMessageFrom(oauth2, session, ids[i]).catch(() => "");
          const key = parseSender(from);
          counts.set(key, (counts.get(key) || 0) + 1);
        }

        const sorted = Array.from(counts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([sender, count]) => ({ sender, count }));

        return {
          ok: true,
          senders: sorted,
          sampled: ids.length,
          scanned: scanN,
          limited: scanN < ids.length,
          note: "Computed from a capped sample to minimize Gmail quota.",
        };
      });

      sessionStore[session].sendersCache[cacheKey] = { ...out, cachedAt: Date.now() };
      return res.json(out);
    } catch (e) {
      if (e instanceof RateLimitedError && cached) {
        return res.json({ ...cached, fromCache: true, note: "Served from cache due to Gmail quota." });
      }
      console.error("senders error:", e);
      // Never 500
      return res.json({
        ok: true,
        senders: [],
        sampled: 0,
        scanned: 0,
        limited: true,
        note: "Temporarily unavailable.",
      });
    }
  });

  return router;
}
