// server/routes/trends.js
import express from "express";
import { listMessages } from "../lib/gmailSafe.js";
import { coalesce } from "../lib/inflight.js";

export default function trendsRouteFactory({ sessionStore }) {
  const router = express.Router();

  // ---- Tunables (env overrides) ----
  const CALL_TIMEOUT_MS = Number(process.env.STATS_CALL_TIMEOUT_MS || 12_000);
  const PROBE_PAGES     = Number(process.env.STATS_APPROX_PROBE_PAGES || 2);    // 1–2 is enough to break the 201 plateau
  const PROBE_PAGE_SIZE = Number(process.env.STATS_APPROX_PROBE_PAGE_SIZE || 500);
  const CONCURRENCY     = Number(process.env.TRENDS_CONCURRENCY || 3);
  const TTL_MS          = Number(process.env.TRENDS_TTL_MS || 5 * 60_000);

  const withTimeout = (p, ms, label) =>
    Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT:" + label)), ms)),
    ]);

  const ymd = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}/${m}/${dd}`; // Gmail wants slashes
  };

  const daysForRange = (r) =>
    r === "1d" ? 1 : r === "7d" ? 7 : r === "30d" ? 30 : r === "60d" ? 60 : r === "90d" ? 90 : 7;

  function makeDayWindows(n) {
    const out = [];
    const today0 = new Date();
    today0.setHours(0, 0, 0, 0);
    for (let i = n - 1; i >= 0; i--) {
      const start = new Date(today0);
      start.setDate(start.getDate() - i);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      out.push({ start, end, label: ymd(start) });
    }
    return out;
  }

  // --- NEW: count strictly by paging (no estimate), with an estimate fallback only if pages say 0
  async function countByPagesOnly(oauth2, sid, q) {
    let total = 0, pageToken, pages = 0;
    do {
      const page = await withTimeout(
        listMessages(oauth2, sid, {
          q,
          maxResults: PROBE_PAGE_SIZE,
          pageToken,
          includeSpamTrash: false,
        }),
        CALL_TIMEOUT_MS,
        "trends:pages"
      );
      const msgs = Array.isArray(page?.messages) ? page.messages : [];
      total += msgs.length;
      pageToken = page?.nextPageToken;
      pages += 1;
    } while (pageToken && pages < PROBE_PAGES);

    if (total === 0) {
      // rare fallback to break “all zeros” if Gmail didn’t return ids for this slice
      const est = await withTimeout(
        listMessages(oauth2, sid, { q, maxResults: 1 }),
        CALL_TIMEOUT_MS,
        "trends:est"
      );
      return Number(est?.resultSizeEstimate || 0);
    }

    return total;
  }

  router.get("/trends", async (req, res) => {
    try {
      const session = String(req.query.session || "");
      const range   = String(req.query.range || "7d");
      if (!session || !sessionStore[session]?.oauth2Client) {
        return res.status(401).json({ ok: false, error: "NO_SESSION" });
      }
      const oauth2 = sessionStore[session].oauth2Client;

      // cache
      sessionStore[session].trendsCache ||= {};
      const cached = sessionStore[session].trendsCache[range];
      if (cached && Date.now() - cached.cachedAt < TTL_MS) {
        return res.json(cached.data);
      }

      const key = `trends:${session}:${range}`;
      const out = await coalesce(key, async () => {
        const n = daysForRange(range);
        const buckets = makeDayWindows(n);
        const daily = new Array(n);
        let i = 0;

        async function worker() {
          while (i < buckets.length) {
            const idx = i++;
            const { start, end, label } = buckets[idx];
            const after = ymd(start);
            const before = ymd(end);

            // absolute day slices; these *must* be different per day
            const baseQ   = `in:inbox after:${after} before:${before}`;
            const unreadQ = `${baseQ} is:unread`;

            try {
              const [total, unread] = await Promise.all([
                countByPagesOnly(oauth2, session, baseQ),
                countByPagesOnly(oauth2, session, unreadQ),
              ]);
              daily[idx] = { date: label, total, read: Math.max(0, total - unread), unread };
            } catch {
              daily[idx] = { date: label, total: 0, read: 0, unread: 0 };
            }
          }
        }

        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, buckets.length) }, () => worker())
        );

        const payload = { ok: true, range, daily };
        sessionStore[session].trendsCache[range] = { cachedAt: Date.now(), data: payload };
        return payload;
      });

      return res.json(out);
    } catch (e) {
      console.error("trends error:", e);
      return res.json({ ok: true, range: String(req.query.range || "7d"), daily: [] });
    }
  });

  return router;
}
