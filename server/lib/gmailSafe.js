// server/lib/gmailSafe.js
import { google } from "googleapis";

export class RateLimitedError extends Error {
  constructor(message = "RATE_LIMITED", retryAfterMs = 10_000, raw) {
    super(message);
    this.name = "RateLimitedError";
    this.retryAfterMs = retryAfterMs;
    this.raw = raw;
  }
}

function isQuota(e) {
  const code = e?.code ?? e?.status;
  const msg = e?.message || e?.cause?.message || e?.response?.data?.error?.message || "";
  const reasons = e?.response?.data?.error?.errors || e?.cause?.errors || [];
  const reasonStr = reasons.map(r => r.reason).join(",").toLowerCase();
  const hay = `${msg} ${reasonStr}`.toLowerCase();
  return code === 403 && (hay.includes("quota") || hay.includes("rate") || hay.includes("per minute"));
}

function gmailClient(oauth2) {
  return google.gmail({ version: "v1", auth: oauth2 });
}

/** List messages cheaply; we only need resultSizeEstimate (ids optional). */
export async function listMessages(oauth2, _sessionId, params) {
  try {
    const res = await gmailClient(oauth2).users.messages.list({
      userId: "me",
      maxResults: 1,
      ...params,            // callers can override maxResults (e.g., 500 for exact)
    });
    return res?.data || {};
  } catch (e) {
    if (isQuota(e)) throw new RateLimitedError("RATE_LIMITED: QPM exceeded", 10_000, e);
    throw e;
  }
}

/** Fetch only the From header for a message id. (Used by TopSenders) */
export async function getMessageFrom(oauth2, _sessionId, id) {
  try {
    const res = await gmailClient(oauth2).users.messages.get({
      userId: "me",
      id,
      format: "metadata",
      metadataHeaders: ["From"],
    });
    const headers = res?.data?.payload?.headers || [];
    const from = (headers.find(h => h.name?.toLowerCase() === "from") || {}).value || "";
    return from;
  } catch (e) {
    if (isQuota(e)) throw new RateLimitedError("RATE_LIMITED: QPM exceeded", 10_000, e);
    throw e;
  }
}
