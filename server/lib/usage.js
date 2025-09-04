// Firestore usage ledger + daily aggregates for AI Inbox Assistant
// Node 20 / Express. Requires `firebase-admin`.
// Env: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
// Day buckets use America/Chicago; timestamps stored in ISO UTC.

/* eslint-disable no-console */
import admin from "firebase-admin";

/**
 * Initialize firebase-admin only once per process.
 * Supports Render/Vercel ephemeral environments.
 */
function getFirestore() {
  if (admin.apps.length === 0) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        "Missing Firebase env vars. Required: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY"
      );
    }

    // Support both raw and \n-escaped keys
    if (privateKey.includes("\\n")) {
      privateKey = privateKey.replace(/\\n/g, "\n");
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }
  return admin.firestore();
}

/**
 * Format a YYYY-MM-DD day key in America/Chicago timezone.
 * @param {Date|number|string} d
 * @returns {string} "YYYY-MM-DD"
 */
function chicagoDayKey(d = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA yields YYYY-MM-DD
  return fmt.format(new Date(d));
}

/**
 * Safely coerce possibly-undefined numbers to 0.
 * @param {number|undefined|null} n
 * @returns {number}
 */
function n0(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/**
 * Record a single analysis request usage.
 *
 * Writes:
 *  - Ledger doc: /usage_ledger/{dayKey}/{autoId}
 *  - Aggregate doc: /usage_daily/{dayKey}:{sessionId}
 *
 * @param {Object} p
 */
export async function recordAnalyzeUsage(p) {
  const db = getFirestore();
  const now = new Date();
  const dayKey = chicagoDayKey(now);

  const sessionId = p.sessionId || "unknown";
  const userId = p.userId || null;
  const model = p.model || null;
  const promptTokens = n0(p.promptTokens);
  const completionTokens = n0(p.completionTokens);
  const totalTokens = promptTokens + completionTokens;
  const cached = Boolean(p.cached);
  const ok = p.ok !== false; // default true
  const error = p.error || null;
  const counts = p.counts || {};
  const cachedCount = n0(counts.cachedCount);
  const computedCount = n0(counts.computedCount);
  const meta = p.meta || null;

  // Per-request ledger (partitioned by day)
  const ledgerColl = db.collection("usage_ledger").doc(dayKey).collection("rows");
  const ledgerDoc = {
    ts: now.toISOString(),
    dayKey,
    sessionId,
    userId,
    model,
    tokens: {
      prompt: promptTokens,
      completion: completionTokens,
      total: totalTokens,
    },
    cached,
    ok,
    error,
    counts: {
      cachedCount,
      computedCount,
    },
    meta,
  };

  // Daily aggregate doc
  const aggId = `${dayKey}:${sessionId}`;
  const aggRef = db.collection("usage_daily").doc(aggId);

  // Use a transaction to ensure atomicity
  await db.runTransaction(async (tx) => {
    tx.set(ledgerColl.doc(), ledgerDoc, { merge: false });

    const inc = admin.firestore.FieldValue.increment;
    const baseIncrements = {
      requests: inc(1),
      cachedHits: inc(cached ? 1 : 0),
      errors: inc(ok ? 0 : 1),
      tokensPrompt: inc(promptTokens),
      tokensCompletion: inc(completionTokens),
      tokensTotal: inc(totalTokens),
      cachedCount: inc(cachedCount),
      computedCount: inc(computedCount),
    };

    tx.set(
      aggRef,
      {
        dayKey,
        sessionId,
        userId: userId || null,
        models: model ? { [model]: inc(1) } : {},
        ...baseIncrements,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (model) {
      tx.set(
        aggRef,
        { perModel: { [model]: { requests: inc(1), tokensTotal: inc(totalTokens) } } },
        { merge: true }
      );
    }
  });
}

/**
 * Read recent daily aggregates for a session.
 * Limits to 30 days. Defaults to 7.
 *
 * @param {Object} p
 */
export async function getDailyUsage(p) {
  const db = getFirestore();
  const sessionId = p.sessionId;
  let days = Number(p.days ?? 7);
  if (!Number.isFinite(days) || days <= 0) days = 7;
  if (days > 30) days = 30;

  const keys = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    keys.push(chicagoDayKey(d));
  }

  const ids = keys.map((k) => `${k}:${sessionId}`);

  const batches = [];
  const chunkSize = 10;
  for (let i = 0; i < ids.length; i += chunkSize) {
    batches.push(ids.slice(i, i + chunkSize));
  }

  const results = [];
  for (const chunk of batches) {
    const snaps = await Promise.all(
      chunk.map((id) => db.collection("usage_daily").doc(id).get())
    );
    for (const snap of snaps) {
      if (snap.exists) {
        const data = snap.data() || {};
        results.push({
          dayKey: data.dayKey,
          sessionId: data.sessionId,
          requests: data.requests || 0,
          tokensTotal: data.tokensTotal || 0,
          tokensPrompt: data.tokensPrompt || 0,
          tokensCompletion: data.tokensCompletion || 0,
          cachedHits: data.cachedHits || 0,
          errors: data.errors || 0,
          cachedCount: data.cachedCount || 0,
          computedCount: data.computedCount || 0,
        });
      }
    }
  }

  const order = new Map(keys.map((k, idx) => [k, idx]));
  results.sort((a, b) => (order.get(a.dayKey) ?? 0) - (order.get(b.dayKey) ?? 0));
  return results;
}

export default {
  getFirestore,
  recordAnalyzeUsage,
  getDailyUsage,
};
