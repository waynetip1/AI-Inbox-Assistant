// server/routes/stats.js
import express from "express";
import crypto from "node:crypto";
import { listMessages } from "../lib/gmailSafe.js";
import { coalesce } from "../lib/inflight.js";

export default function statsRouteFactory({ sessionStore }) {
  const router = express.Router();

  // ---------- Feature flags / tunables ----------
  // Which ranges are allowed to run exact? e.g. "1d,7d" (default) or "1d,7d,30d,60d,90d"
  const ALLOW_EXACT_RANGES = new Set(
    String(process.env.ALLOW_EXACT_RANGES || "1d,7d")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );

  // Approximation budgets
  const APPROX_TTL_MS = 60_000; // 1d cache TTL
  const OTHER_TTL_MS = 180_000; // others
  const APPROX_BUDGET_MS = Number(process.env.STATS_APPROX_BUDGET_MS || 6_000);
  const APPROX_CALL_TIMEOUTMS = Number(process.env.STATS_APPROX_CALL_TIMEOUT_MS || 1_500);
  const APPROX_CONCURRENCY = Number(process.env.STATS_APPROX_CONCURRENCY || 6);

  // Exact budgets
  const EXACT_ROUTE_TIMEOUT_MS = Number(process.env.STATS_EXACT_ROUTE_TIMEOUT_MS || 20_000);
  const EXACT_PAGE_TIMEOUT_MS = Number(process.env.STATS_EXACT_PAGE_TIMEOUT_MS || 6_000);
  const EXACT_CAP_MSGS = Number(process.env.STATS_EXACT_CAP_MSGS || 2_000);
  const EXACT_CAP_PAGES = Number(process.env.STATS_EXACT_CAP_PAGES || 6);
  const EXACT_CONCURRENCY = Math.max(1, Number(process.env.STATS_EXACT_CONCURRENCY || 2));

  // Bucketed approx for long ranges
  const SLICES_30D = Number(process.env.STATS_BUCKET_SLICES_30D || 3);
  const SLICES_60D = Number(process.env.STATS_BUCKET_SLICES_60D || 4);
  const SLICES_90D = Number(process.env.STATS_BUCKET_SLICES_90D || 6);
  const BUCKETED_KEYS = new Set(["inbox", "promotions", "social", "updates", "forums", "sent", "spam"]);

  const ttlFor = (range) => (range === "1d" ? APPROX_TTL_MS : OTHER_TTL_MS);

  // ---------- Query builders ----------
  const rangeToWin = (r) =>
    ["1d", "7d", "30d", "60d", "90d"].includes(r) ? `newer_than:${r}` : "newer_than:7d";
  const joinQ = (base, win, extra = "") => [base, win, extra].filter(Boolean).join(" ").trim();

  function baseQueriesFromWindow(win) {
    return {
      inbox: joinQ("in:inbox", win),
      unread: joinQ("in:inbox", win, "is:unread"),
      starredImportant: joinQ("in:inbox", win, "(is:starred OR is:important)"),
      spam: joinQ("in:spam", win),
      sent: joinQ("in:sent", win),
      drafts: joinQ("in:drafts", win),
      promotions: joinQ("in:inbox", win, "category:promotions"),
      social: joinQ("in:inbox", win, "category:social"),
      updates: joinQ("in:inbox", win, "category:updates"),
      forums: joinQ("in:inbox", win, "category:forums"),
      starred: joinQ("in:inbox", win, "is:starred"),
    };
  }
  const baseQueries = (range) => baseQueriesFromWindow(rangeToWin(range));

  // ---------- Utils ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT:${label}`)), ms)),
    ]);
  }
  function makeETag(obj) {
    return `W/"${crypto.createHash("sha1").update(JSON.stringify(obj)).digest("hex")}"`;
  }

  function finalizeFromRaw(raw, note, queriesForClient, exact = false) {
    const inbox = raw.inbox || 0;
    const promotions = raw.promotions || 0;
    const social = raw.social || 0;
    const updates = raw.updates || 0;
    const forums = raw.forums || 0;
    const personal = Math.max(0, inbox - (promotions + social + updates + forums));
    return {
      ok: true,
      totals: {
        inbox,
        unread: raw.unread || 0,
        starredImportant: raw.starredImportant || 0,
        spam: raw.spam || 0,
        sent: raw.sent || 0,
        drafts: raw.drafts || 0,
        promotions,
        social,
        updates,
        forums,
        starred: raw.starred || 0,
        personal,
      },
      meta: { estimated: !exact, exact, note },
      queries: queriesForClient,
    };
  }

  // ---------- APPROX ----------
  async function safeCountApprox(oauth2, sid, q, deadline, cachedVal) {
    if (Date.now() > deadline) return cachedVal ?? 0;
    try {
      const data = await withTimeout(
        listMessages(oauth2, sid, { q, maxResults: 1 }),
        APPROX_CALL_TIMEOUTMS,
        "approxCount"
      );
      return Number(data?.resultSizeEstimate || 0);
    } catch {
      return cachedVal ?? 0;
    }
  }

  async function computeApproxSingle(oauth2, sid, range, previousCached) {
    const start = Date.now();
    const deadline = start + APPROX_BUDGET_MS;
    const q = baseQueries(range);
    const keys = Object.keys(q);
    const raw = {};
    let i = 0;
    async function worker() {
      while (i < keys.length) {
        const k = keys[i++];
        const cachedVal = previousCached?.totals?.[k] ?? undefined;
        raw[k] = await safeCountApprox(oauth2, sid, q[k], deadline, cachedVal);
      }
    }
    await Promise.all(Array.from({ length: Math.min(APPROX_CONCURRENCY, keys.length) }, worker));
    return finalizeFromRaw(raw, "Fast estimate via resultSizeEstimate.", q, false);
  }

  // Bucketed slices for 30/60/90 so 30≠60≠90
  const DAY_MS = 86400000;
  const rangeDays = (r) => (r === "30d" ? 30 : r === "60d" ? 60 : 90);
  const slicesFor = (r) => (r === "30d" ? SLICES_30D : r === "60d" ? SLICES_60D : SLICES_90D);
  const floorUtcMid = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const addDays = (d, n) => new Date(d.getTime() + n * DAY_MS);
  const ymd = (d) =>
    `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;

  function buildSlices(range) {
    const days = rangeDays(range);
    const want = Math.max(2, Math.min(12, slicesFor(range)));
    const end = addDays(floorUtcMid(new Date()), 1); // tomorrow 00:00 UTC
    const start = addDays(end, -days);
    const step = Math.ceil(days / want);
    const wins = [];
    for (let cur = start; cur < end; ) {
      const next = addDays(cur, step);
      const stop = next < end ? next : end;
      wins.push(`after:${ymd(cur)} before:${ymd(stop)}`);
      cur = stop;
    }
    return wins;
  }

  async function computeApproxBucketed(oauth2, sid, range, previousCached) {
    const start = Date.now();
    const deadline = start + APPROX_BUDGET_MS;

    const allKeys = Object.keys(baseQueriesFromWindow(""));
    const raw = Object.create(null);
    for (const k of allKeys) raw[k] = 0;

    const sliceWins = buildSlices(range);

    // bucket "big" keys by slice
    const work = [];
    for (const win of sliceWins) {
      const qmap = baseQueriesFromWindow(win);
      for (const k of allKeys) {
        if (BUCKETED_KEYS.has(k)) work.push({ k, q: qmap[k] });
      }
    }
    // non-bucketed once across full window
    const full = baseQueries(range);
    for (const k of allKeys) {
      if (!BUCKETED_KEYS.has(k)) work.push({ k, q: full[k] });
    }

    let i = 0;
    async function worker() {
      while (i < work.length) {
        const job = work[i++];
        const n = await safeCountApprox(oauth2, sid, job.q, deadline, undefined);
        raw[job.k] += Number(n || 0);
      }
    }
    await Promise.all(Array.from({ length: Math.min(APPROX_CONCURRENCY, work.length) }, worker));

    return finalizeFromRaw(raw, `Bucketed estimate across ${sliceWins.length} slice(s).`, full, false);
  }

  // ---------- EXACT ----------
  async function exactCount(oauth2, sid, q) {
    let total = 0,
      pageToken,
      pages = 0;
    while (pages < EXACT_CAP_PAGES && total < EXACT_CAP_MSGS) {
      const data = await withTimeout(
        listMessages(oauth2, sid, { q, maxResults: 500, pageToken }),
        EXACT_PAGE_TIMEOUT_MS,
        "exactPage"
      );
      const n = Array.isArray(data?.messages) ? data.messages.length : 0;
      total += n;
      pageToken = data?.nextPageToken;
      pages += 1;
      if (!pageToken || n === 0) break;
    }
    return total;
  }

  async function computeExactRange(oauth2, sid, range) {
    const q = baseQueries(range);
    const keys = Object.keys(q);
    const raw = {};
    let i = 0;

    async function worker() {
      while (i < keys.length) {
        const k = keys[i++];
        raw[k] = await exactCount(oauth2, sid, q[k]).catch(() => 0);
      }
    }

    await Promise.race([
      Promise.all(Array.from({ length: EXACT_CONCURRENCY }, worker)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT:routeExact")), EXACT_ROUTE_TIMEOUT_MS)),
    ]);

    return finalizeFromRaw(raw, "Exact via paged scan with safety caps.", q, true);
  }

  // ---------- Cache helpers ----------
  function cacheGet(sid, range) {
    sessionStore[sid].statsCache = sessionStore[sid].statsCache || {};
    return sessionStore[sid].statsCache[range];
  }
  function cacheSetPreferExact(sid, range, payload) {
    sessionStore[sid].statsCache = sessionStore[sid].statsCache || {};
    const existing = sessionStore[sid].statsCache[range];
    if (existing?.data?.meta?.exact && !payload?.meta?.exact) return existing;
    const saved = { data: payload, etag: makeETag(payload), cachedAt: Date.now() };
    sessionStore[sid].statsCache[range] = saved;
    return saved;
  }
  function sendCached(res, cached) {
    res.set("ETag", cached.etag);
    res.set("Cache-Control", "private, max-age=60");
    return res.json(cached.data);
  }

  // ---------- Route ----------
  router.get("/stats", async (req, res) => {
    const session = String(req.query.session || "");
    const range = String(req.query.range || "7d");
    const wantExact = String(req.query.exact || "").toLowerCase() === "true";

    if (!session || !sessionStore[session]?.oauth2Client) {
      return res.status(401).json({ ok: false, error: "NO_SESSION" });
    }
    const oauth2 = sessionStore[session].oauth2Client;

    const now = Date.now();
    const cached = cacheGet(session, range);
    const fresh = cached && now - cached.cachedAt < ttlFor(range);
    const inm = req.headers["if-none-match"];

    if (fresh && cached?.data?.meta?.exact) {
      if (inm && inm === cached.etag) return res.status(304).end();
      return sendCached(res, cached);
    }
    if (!wantExact && fresh && inm && inm === cached.etag) return res.status(304).end();
    if (!wantExact && fresh) return sendCached(res, cached);

    try {
      const exactAllowed = ALLOW_EXACT_RANGES.has(range);
      const key = `stats:${session}:${range}:exact=${wantExact && exactAllowed ? "1" : "0"}`;

      const out = await coalesce(key, async () => {
        if (wantExact && exactAllowed) {
          try {
            return await computeExactRange(oauth2, session, range);
          } catch {
            // fallback to approx on timeout
            const approx =
              range === "30d" || range === "60d" || range === "90d"
                ? await computeApproxBucketed(oauth2, session, range, cached?.data)
                : await computeApproxSingle(oauth2, session, range, cached?.data);
            approx.meta.note = "Exact unavailable (timeout). Showing estimate.";
            return approx;
          }
        }

        // Approx path
        return range === "30d" || range === "60d" || range === "90d"
          ? await computeApproxBucketed(oauth2, session, range, cached?.data)
          : await computeApproxSingle(oauth2, session, range, cached?.data);
      });

      const saved = cacheSetPreferExact(session, range, out);
      res.set("ETag", saved.etag);
      res.set("Cache-Control", "private, max-age=60");
      return res.json(out);
    } catch (e) {
      if (cached) {
        res.set("ETag", cached.etag);
        res.set("Cache-Control", "private, max-age=60");
        const data = { ...cached.data, meta: { ...(cached.data.meta || {}), note: "Served cached due to error." } };
        return res.json(data);
      }
      const q = baseQueries(range);
      return res.json({
        ok: true,
        totals: {
          inbox: 0,
          unread: 0,
          starredImportant: 0,
          spam: 0,
          sent: 0,
          drafts: 0,
          promotions: 0,
          social: 0,
          updates: 0,
          forums: 0,
          starred: 0,
          personal: 0,
        },
        meta: { estimated: true, exact: false, note: "Degraded: temporary error." },
        queries: q,
      });
    }
  });

  return router;
}
