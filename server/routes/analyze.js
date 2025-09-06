// server/routes/analyze.js
import express from "express";
import { google } from "googleapis";
import { providerForTier } from "../llmProvider.js";
import OpenAI from "openai";

/** Light HTML → text */
function stripHtml(html = "") {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAddr(raw = "") {
  const m = raw.match(/^(?:"?([^"]*)"?\s)?<?([^<>@\s]+@[^<>@\s]+)>?$/);
  if (m) return { name: (m[1] || "").trim(), email: (m[2] || "").trim() };
  return { name: "", email: raw.trim() };
}

function parseAddressList(raw = "") {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => parseAddr(s.trim()))
    .filter((x) => x.email);
}

// ---------- helpers ----------
function base64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildRawEmail({ to, subject, body }) {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ];
  return base64url(lines.join("\r\n"));
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

function maybeQuote(s) {
  return /\s/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

// ---------------- CASA-SAFE SEARCH (metadata only) ----------------
async function handleSearch(req, res, sessionStore) {
  const sessionId = req.query.session?.toString() || "TEST123";
  const session = sessionStore[sessionId];
  if (!session?.oauth2Client) {
    return res.status(401).json({
      ok: false,
      error: "NO_SESSION",
      message: "Authenticate first at /auth/google?session=YOUR_SESSION_ID",
    });
  }

  const from = (req.query.from || "").toString().trim();
  const to = (req.query.to || "").toString().trim();
  const subject = (req.query.subject || "").toString().trim();
  const newer = (req.query.newer_than || "7d").toString().trim();
  const limit = Math.max(1, Math.min(parseInt(req.query.limit || "20", 10), 50));

  const qParts = ["in:inbox"];
  if (from) qParts.push(`from:${maybeQuote(from)}`);
  if (to) qParts.push(`to:${maybeQuote(to)}`);
  if (subject) qParts.push(`subject:${maybeQuote(subject)}`);
  if (newer) qParts.push(`newer_than:${newer}`);
  const q = qParts.join(" ").trim();

  try {
    const gmail = google.gmail({ version: "v1", auth: session.oauth2Client });

    const list = await gmail.users.messages.list({
      userId: "me",
      maxResults: limit,
      q,
    });

    const items = list.data.messages || [];
    if (items.length === 0) {
      return res.json({ ok: true, meta: { qBuilt: q, limit }, results: [] });
    }

    const metas = await Promise.all(
      items.map((m) =>
        gmail.users.messages.get({
          userId: "me",
          id: m.id,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "To", "Cc", "Date", "Reply-To", "Message-Id"],
        })
      )
    );

    const results = metas.map(({ data }) => {
      const H = Object.fromEntries(
        (data.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value])
      );
      const subj = H["subject"] || "";
      const fromAddr = parseAddr(H["from"] || "");
      const toList = parseAddressList(H["to"] || "");
      const ccList = parseAddressList(H["cc"] || "");
      const internalMs = data.internalDate ? Number(data.internalDate) : undefined;
      const threadId = data.threadId;
      const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${threadId}`;
      return {
        id: data.id,
        threadId,
        subject: subj,
        from: fromAddr,
        to: toList,
        cc: ccList,
        date: internalMs ? new Date(internalMs).toISOString() : undefined,
        gmailUrl,
      };
    });

    res.json({ ok: true, meta: { qBuilt: q, limit }, results });
  } catch (err) {
    console.error("search (metadata) error:", err);
    res.status(500).json({ ok: false, error: "SEARCH_FAILED", message: err.message });
  }
}

// ---------------- CREATE DRAFT (CASA-safe, user-provided only) ----------------
async function handleCreateDraft(req, res, sessionStore) {
  const sessionId = req.query.session?.toString() || "TEST123";
  const session = sessionStore[sessionId];
  if (!session?.oauth2Client) {
    return res.status(401).json({
      ok: false,
      error: "NO_SESSION",
      message: "Authenticate first at /auth/google?session=YOUR_SESSION_ID",
    });
  }

  const to = String(req.body?.to || "").trim();
  const subject = String(req.body?.subject || "").trim();
  const body = String(req.body?.body || "").trim();
  const threadId = String(req.body?.threadId || "").trim() || undefined;

  if (!to || !subject || body.length < 1) {
    return res.status(400).json({
      ok: false,
      error: "INVALID_INPUT",
      message: "to, subject, and body are required.",
    });
  }

  try {
    const gmail = google.gmail({ version: "v1", auth: session.oauth2Client });

    const raw = buildRawEmail({ to, subject, body });
    const requestBody = { message: { raw } };
    if (threadId) requestBody.message.threadId = threadId;

    const { data } = await gmail.users.drafts.create({
      userId: "me",
      requestBody,
    });

    const createdThreadId = data?.message?.threadId || threadId;
    const gmailUrl = createdThreadId
      ? `https://mail.google.com/mail/u/0/#inbox/${createdThreadId}`
      : `https://mail.google.com/mail/u/0/#drafts`;

    res.json({
      ok: true,
      draftId: data?.id || null,
      messageId: data?.message?.id || null,
      threadId: createdThreadId || null,
      gmailUrl,
    });
  } catch (err) {
    console.error("create draft error:", err?.errors || err?.message || err);
    res.status(500).json({
      ok: false,
      error: "CREATE_DRAFT_FAILED",
      message: err?.message || "Failed to create draft",
    });
  }
}

// ---------------- COMPOSE REPLY (CASA-safe, user-provided only) ----------------
async function callProviderCompose(provider, { original, subject, to, style }) {
  // If your provider has a dedicated compose API, use it
  if (typeof provider?.composeReply === "function") {
    const out = await provider.composeReply({ original, subject, to, style });
    return String(out || "").trim();
  }

  // Fallback: OpenAI
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Compose fallback unavailable: OPENAI_API_KEY not set");
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_COMPOSE_MODEL || "gpt-4o-mini";

  const sys = [
    "You are a concise, helpful email writing assistant.",
    "Write a reply the user can paste as-is.",
    "Be professional, friendly, and efficient.",
    "Do not include the original message unless explicitly asked.",
    "Keep it short unless the original contains multiple questions.",
  ].join(" ");

  const user = [
    subject ? `Subject: ${subject}` : "",
    to ? `To: ${to}` : "",
    style ? `Style: ${style}` : "Style: professional, friendly, concise",
    "",
    "Original message:",
    original,
    "",
    "Write the reply:",
  ]
    .filter(Boolean)
    .join("\n");

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.4,
    max_tokens: 400,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
  });

  const text =
    resp?.choices?.[0]?.message?.content?.trim() ||
    resp?.choices?.[0]?.text?.trim() ||
    "";
  return text;
}

async function handleComposeReply(req, res, sessionStore) {
  // CASA-safe: we still require auth to respect tiering, but we never read Gmail.
  const sessionId = req.query.session?.toString() || "TEST123";
  const session = sessionStore[sessionId];
  if (!session?.oauth2Client) {
    return res.status(401).json({
      ok: false,
      error: "NO_SESSION",
      message: "Authenticate first at /auth/google?session=YOUR_SESSION_ID",
    });
  }

  const original = String(req.body?.original || "").trim();
  const subject = String(req.body?.subject || "").trim();
  const to = String(req.body?.to || "").trim();
  const style = String(req.body?.style || "").trim(); // optional: "brief", "friendly", "formal"...

  if (original.length < 10) {
    return res.status(400).json({
      ok: false,
      error: "INVALID_INPUT",
      message: "Paste the original message (10+ chars) to compose a reply.",
    });
  }

  try {
    const tier = "free";
    const provider = providerForTier(tier);
    const reply = await callProviderCompose(provider, { original, subject, to, style });
    res.json({ ok: true, reply });
  } catch (err) {
    console.error("compose reply error:", err?.message || err);
    res.status(500).json({
      ok: false,
      error: "COMPOSE_FAILED",
      message: err?.message || "Failed to compose reply",
    });
  }
}

// ---------------- EXISTING /analyze (kept; UI-gated by CASA flag) --------------
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
  // CASA-safe metadata search
  router.get("/search", (req, res) => handleSearch(req, res, sessionStore));
  // NEW: compose reply (CASA-safe)
  router.post("/compose/reply", (req, res) => handleComposeReply(req, res, sessionStore));
  // NEW: create draft (CASA-safe)
  router.post("/drafts", (req, res) => handleCreateDraft(req, res, sessionStore));
  // Existing analyze endpoints
  router.post("/analyze", (req, res) => handleAnalyze(req, res, sessionStore));
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
