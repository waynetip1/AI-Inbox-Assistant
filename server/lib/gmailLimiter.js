// server/lib/gmailLimiter.js
// Simple per-key token-bucket limiter for "Queries Per Minute" (QPM).
const buckets = new Map();

function ensureBucket(key, qpm) {
  if (buckets.has(key)) return buckets.get(key);
  const hits = [];
  const bucket = {
    qpm,
    async take() {
      const now = Date.now();
      for (let i = hits.length - 1; i >= 0; i--) if (now - hits[i] > 60_000) hits.splice(i, 1);
      if (hits.length < qpm) { hits.push(now); return; }
      const waitMs = Math.max(10, 60_000 - (now - hits[0]));
      await new Promise(r => setTimeout(r, waitMs + Math.floor(Math.random() * 50)));
      return this.take();
    }
  };
  buckets.set(key, bucket);
  return bucket;
}

export function getLimiter(key, qpmEnv) {
  const qpm = Number(qpmEnv || process.env.GMAIL_QPM_PER_USER || 30);
  return ensureBucket(key || "global", qpm > 0 ? qpm : 30);
}
