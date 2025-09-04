// server/index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import authRoute from "./routes/auth.js";
import statsRoute from "./routes/stats.js";
import trendsRoute from "./routes/trends.js";
import analyzeRoute from "./routes/analyze.js";
import sendersRoute from "./routes/senders.js"; // NEW

import ensureSession from "./middleware/ensureSession.js";

dotenv.config();

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: false,
    exposedHeaders: [
      "X-Analyze-Provider",
      "X-Analyze-Cached",
      "X-Analyze-Computed",
      "X-Analyze-Prompt-Tokens",
      "X-Analyze-Completion-Tokens",
      "X-Analyze-Daily-Used",
      "X-Analyze-Daily-Limit",
      "X-Analyze-Daily-Remaining",
    ],
  })
);

// In-memory session store
export const sessionStore = Object.create(null);

// Health
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "AI Inbox Assistant API",
    env: {
      hasOpenAIKey: !!process.env.OPENAI_API_KEY,
      hasGoogleClient: !!process.env.GOOGLE_CLIENT_ID,
      hasGeminiKey: !!process.env.GOOGLE_GENAI_API_KEY,
      providerFree: process.env.FREE_TIER_PROVIDER || "openai",
      redirectUri: process.env.GOOGLE_REDIRECT_URI,
    },
  });
});

// Auth (no session required)
app.use("/auth", authRoute({ sessionStore }));

// --- Protected APIs: auto-rehydrate/require session ---
app.use("/api", ensureSession({ sessionStore }));

// Stats & trends
app.use("/api", statsRoute({ sessionStore }));
app.use("/api", trendsRoute({ sessionStore }));

// Analyze
app.use("/api", analyzeRoute({ sessionStore }));          // -> /api/analyze
app.use("/api/emails", analyzeRoute({ sessionStore }));   // -> /api/emails/analyze and /api/emails

// Top senders (NEW)
app.use("/api", sendersRoute({ sessionStore }));

// Dev debug
if (process.env.NODE_ENV !== "production") {
  app.get("/api/debug/session", (_req, res) => {
    const entries = Object.entries(sessionStore).map(([id, s]) => ({
      id,
      hasClient: !!s?.oauth2Client,
      hasTokens: !!s?.tokens,
      hasDaily: !!s?.daily,
      user: s?.user?.email || null,
    }));
    res.json({ ok: true, count: entries.length, entries });
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
