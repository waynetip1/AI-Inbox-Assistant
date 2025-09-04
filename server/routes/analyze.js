// server/routes/analyze.js
import express from "express";
import { google } from "googleapis";
import { providerForTier } from "../llmProvider.js";

/** Light HTML → text */
function stripHtml(html = "") {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchMessageText(gmail, msgId) {
  const { data } = await gmail.users.messages.get({
    userId: "me",
    id: msgId,
    format: "full",
  });

  const headers = Object.fromEntries(
    (data.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value])
  );
  const subject = headers["subject"] || "";
  let bodyText = "";

  const walk = (p) => {
    if (!p) return;
    if (p.mimeType === "text/plain" && p.body?.data) {
      bodyText += Buffer.from(p.body.data, "base64").toString("utf8") + "\n";
    } else if (p.mimeType === "text/html" && p.body?.data) {
      bodyText += stripHtml(Buffer.from(p.body.data, "base64").toString("utf8")) + "\n";
    }
    if (p.parts) p.parts.forEach(walk);
  };
  walk(data.payload);

  const text = `${subject ? `Subject: ${subject}\n\n` : ""}${bodyText || data.snippet || ""}`.trim();
  return { id: msgId, subject, text };
}

function getCache(session) {
  if (!session.summaries) session.summaries = new Map();
  return session.summaries;
}

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

function getDaily(session) {
  const limit = Math.max(1, parseInt(process.env.FREE_DAILY_CAP || "30", 10));
  const today = todayInCST();
  if (!session.daily || session.daily.date !== today) {
    session.daily = { date: today, used: 0, limit };
  } else {
    session.daily.limit = limit;
  }
  return session.daily;
}

// Shared handler used by both /analyze AND /
async function handleAnalyze(req, res, sessionStore) {
  const sessionId = req.query.session?.toString() || "TEST123";
  const limit = Math.min(parseInt(req.query.limit || "5", 10), 20);
  const q = (req.query.q || "").toString();

  const session = sessionStore[sessionId];
  if (!session?.oauth2Client) {
    return res.status(401).json({
      ok: false,
      error: "NO_SESSION",
      message: "Authenticate first at /auth/google?session=YOUR_SESSION_ID",
    });
  }

  const tier = "free";
  const provider = providerForTier(tier);

  try {
    const gmail = google.gmail({ version: "v1", auth: session.oauth2Client });

    // Resolve message IDs
    let messageIds = Array.isArray(req.body?.messageIds)
      ? req.body.messageIds.slice(0, limit)
      : [];

    if (messageIds.length === 0) {
      const list = await gmail.users.messages.list({
        userId: "me",
        maxResults: limit,
        q: q || "in:inbox newer_than:7d",
      });
      messageIds = (list.data.messages || []).map((m) => m.id);
    }

    // Cache & daily cap
    const cache = getCache(session);
    const daily = getDaily(session);

    if (daily.used >= daily.limit) {
      setAnalyzeHeaders(res, {
        provider: provider.name,
        cached: 0,
        computed: 0,
        promptTokens: 0,
        completionTokens: 0,
        dailyUsed: daily.used,
        dailyLimit: daily.limit,
        dailyRemaining: 0,
      });
      return res.status(429).json({
        ok: false,
        error: "DAILY_CAP_EXCEEDED",
        message: `Free tier daily limit reached (${daily.used}/${daily.limit}). Upgrade to Pro for higher limits.`,
      });
    }

    // Build worklist honoring remaining quota
    const remaining = Math.max(0, daily.limit - daily.used);
    const toSummarize = [];
    const analyzed = [];

    for (const id of messageIds) {
      const cacheKey = `${provider.name}:${id}`;
      if (cache.has(cacheKey)) {
        analyzed.push({ id, summary: cache.get(cacheKey), cached: 1 });
        continue;
      }
      if (toSummarize.length < remaining) {
        const { text } = await fetchMessageText(gmail, id);
        toSummarize.push({ id, text });
      } else {
        analyzed.push({ id, summary: "", cached: 0, skippedByCap: 1 });
      }
    }

    // Call provider for non-cached within remaining quota
    let usage = {};
    if (toSummarize.length > 0) {
      const { summaries, usage: u } = await provider.summarize(toSummarize, {
        purpose: "email_summary",
      });
      usage = u || {};
      for (const s of summaries) {
        const cacheKey = `${provider.name}:${s.id}`;
        cache.set(cacheKey, s.summary);
        analyzed.push({ id: s.id, summary: s.summary, cached: 0 });
      }
      daily.used += summaries.length;
    }

    // Keep original order
    const byId = new Map(analyzed.map((a) => [a.id, a]));
    const ordered = messageIds.map((id) => byId.get(id) || { id, summary: "", cached: 0 });

    const meta = {
      provider: provider.name,
      cached: ordered.filter((a) => a.cached).length,
      computed: ordered.filter((a) => !a.cached && !a.skippedByCap && a.summary).length,
      promptTokens: usage.promptTokens ?? 0,
      completionTokens: usage.completionTokens ?? 0,
      dailyUsed: daily.used,
      dailyLimit: daily.limit,
      dailyRemaining: Math.max(0, daily.limit - daily.used),
    };

    setAnalyzeHeaders(res, meta);

    res.json({
      ok: true,
      meta,
      analyzed: ordered.map((a) => ({
        id: a.id,
        summary: a.summary,
        suggestedActions: suggestActionsFromSummary(a.summary),
      })),
      note:
        meta.dailyRemaining === 0
          ? "Daily free limit reached. Cached results still available. Upgrade for more."
          : undefined,
    });
  } catch (err) {
    console.error("analyze error:", err);
    res.status(500).json({ ok: false, error: "ANALYZE_FAILED", message: err.message });
  }
}

export default function analyzeRoute({ sessionStore }) {
  const router = express.Router();
  // Support BOTH endpoints depending on where this router is mounted:
  // - POST /api/analyze
  router.post("/analyze", (req, res) => handleAnalyze(req, res, sessionStore));
  // - POST /api/emails  (when mounted at /api/emails)
  router.post("/", (req, res) => handleAnalyze(req, res, sessionStore));
  return router;
}

/** Tiny heuristic action suggester */
function suggestActionsFromSummary(summary = "") {
  const s = summary.toLowerCase();
  const actions = [];
  if (/(invoice|payment|bill)/.test(s)) actions.push("Star");
  if (/(deadline|due|respond|reply)/.test(s)) actions.push("Mark Important");
  if (/(newsletter|promo|unsubscribe)/.test(s)) actions.push("Archive");
  return actions.slice(0, 2);
}

/** Response headers for cost/usage meters */
function setAnalyzeHeaders(res, meta) {
  res.setHeader(
    "Access-Control-Expose-Headers",
    [
      "X-Analyze-Provider",
      "X-Analyze-Cached",
      "X-Analyze-Computed",
      "X-Analyze-Prompt-Tokens",
      "X-Analyze-Completion-Tokens",
      "X-Analyze-Daily-Used",
      "X-Analyze-Daily-Limit",
      "X-Analyze-Daily-Remaining",
    ].join(",")
  );
  res.setHeader("X-Analyze-Provider", String(meta.provider ?? ""));
  res.setHeader("X-Analyze-Cached", String(meta.cached ?? 0));
  res.setHeader("X-Analyze-Computed", String(meta.computed ?? 0));
  res.setHeader("X-Analyze-Prompt-Tokens", String(meta.promptTokens ?? 0));
  res.setHeader("X-Analyze-Completion-Tokens", String(meta.completionTokens ?? 0));
  res.setHeader("X-Analyze-Daily-Used", String(meta.dailyUsed ?? 0));
  res.setHeader("X-Analyze-Daily-Limit", String(meta.dailyLimit ?? 0));
  res.setHeader("X-Analyze-Daily-Remaining", String(meta.dailyRemaining ?? 0));
}
