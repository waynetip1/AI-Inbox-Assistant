// server/lib/summaryCache.js
// Firestore-backed cache for per-message AI summaries.
// Doc id is `${session}_${msgId}` so multiple users/sessions don't collide.

const { db, Timestamp } = require('./firebaseAdmin');
const crypto = require('crypto');

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function makeDocId(session, msgId) {
  return `${session}_${msgId}`;
}

// Extract a stable set of fields from a full Gmail message resource
// to fingerprint the *content* we summarized (not labels/status).
function pickGmailFingerprint(msg) {
  const id = msg?.id || '';
  const threadId = msg?.threadId || '';
  const internalDate = Number(msg?.internalDate || 0);
  const sizeEstimate = Number(msg?.sizeEstimate || 0);
  const snippet = msg?.snippet || '';

  const headersObj = {};
  const interesting = new Set(['Subject', 'From', 'To', 'Date', 'Message-ID', 'Reply-To']);
  const headersArr = msg?.payload?.headers || [];
  for (const h of headersArr) {
    if (!h?.name || !h?.value) continue;
    if (interesting.has(h.name)) headersObj[h.name] = h.value;
  }

  return {
    id,
    threadId,
    internalDate,
    sizeEstimate,
    snippet,
    headers: headersObj,
  };
}

// Deterministic content hash from the fingerprint
function computeContentHash(fingerprint) {
  const parts = [
    fingerprint.id || '',
    fingerprint.threadId || '',
    String(fingerprint.internalDate || ''),
    String(fingerprint.sizeEstimate || ''),
    fingerprint.headers?.Subject || '',
    fingerprint.headers?.From || '',
    fingerprint.headers?.To || '',
    fingerprint.headers?.Date || '',
    fingerprint.headers?.['Message-ID'] || '',
    fingerprint.headers?.['Reply-To'] || '',
    fingerprint.snippet || '',
  ];
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest('hex').slice(0, 32); // compact 128-bit
}

// Read a cached summary if fresh and matching contentHash
async function getCachedSummary({ session, msgId, contentHash, maxAgeMs = DEFAULT_TTL_MS }) {
  const docId = makeDocId(session, msgId);
  const snap = await db.collection('msgSummaries').doc(docId).get();
  if (!snap.exists) return null;

  const data = snap.data();
  if (!data?.summary || !data?.computedAt?.toMillis) return null;
  if (data.contentHash !== contentHash) return null;

  const age = Date.now() - data.computedAt.toMillis();
  const ttl = Number.isFinite(data.ttlMs) ? data.ttlMs : maxAgeMs;
  if (age > ttl) return null;

  return {
    summary: data.summary,
    actions: data.actions || [],
    model: data.model || null,
    tokens: data.tokens || null,
    computedAt: data.computedAt.toDate(),
  };
}

// Write (or overwrite) a cached summary
async function writeCachedSummary({
  session,
  msgId,
  contentHash,
  summary,
  actions,
  model,
  tokens,
  ttlMs = DEFAULT_TTL_MS,
}) {
  const docId = makeDocId(session, msgId);
  const payload = {
    summary,
    actions: actions || [],
    model: model || null,
    tokens: tokens || null, // { input, output, total, costUsd } optional
    contentHash,
    ttlMs,
    computedAt: Timestamp.now(),
  };
  await db.collection('msgSummaries').doc(docId).set(payload, { merge: true });
  return true;
}

// Optional: “touch” an entry (useful when we delta-validate via historyId)
async function bumpSummaryTimestamp({ session, msgId, ttlMs = DEFAULT_TTL_MS }) {
  const docId = makeDocId(session, msgId);
  await db.collection('msgSummaries').doc(docId).set(
    { computedAt: Timestamp.now(), ttlMs },
    { merge: true }
  );
}

module.exports = {
  DEFAULT_TTL_MS,
  pickGmailFingerprint,
  computeContentHash,
  getCachedSummary,
  writeCachedSummary,
  bumpSummaryTimestamp,
  makeDocId,
};
