// server/index.js
import "dotenv/config.js";
import express from "express";
import cors from "cors";

import authRoute from "./routes/auth.js";
import statsRoute from "./routes/stats.js";
import trendsRoute from "./routes/trends.js";
import analyzeRoute from "./routes/analyze.js";
import sendersRoute from "./routes/senders.js";
import composeRoute from "./routes/compose.js";
import draftsRoute from "./routes/drafts.js";  // <-- NEW
import debugRoute from "./routes/debug.js";

import ensureSession from "./middleware/ensureSession.js";

// Do NOT call dotenv.config(); side-effect import above already loaded env.

const app = express();

app.use(express.json({ limit: "1mb" }));
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
      "X-Compose-Provider",
      "X-Draft-Id",       // <-- NEW
      "X-Thread-Id",      // <-- NEW
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

// 🛠 Dev-only debug routes — BEFORE ensureSession so you can create a dev session
if (process.env.NODE_ENV !== "production") {
  app.use("/api/debug", debugRoute({ sessionStore }));
}

// ✅ CASA-safe compose endpoints — BEFORE ensureSession (they don't need Gmail)
app.use("/api/emails/compose", composeRoute({ sessionStore }));
app.use("/api/compose", composeRoute({ sessionStore }));

// --- Protected APIs: require session rehydration & Gmail for sensitive ops ---
app.use("/api", ensureSession({ sessionStore }));

// Stats & trends
app.use("/api", statsRoute({ sessionStore }));
app.use("/api", trendsRoute({ sessionStore }));

// Analyze
app.use("/api", analyzeRoute({ sessionStore }));          // -> /api/analyze
app.use("/api/emails", analyzeRoute({ sessionStore }));   // -> /api/emails/analyze and /api/emails

// Top senders
app.use("/api", sendersRoute({ sessionStore }));

// ✉️ Drafts (needs Gmail OAuth; mounted after ensureSession)
app.use("/api", draftsRoute({ sessionStore }));           // -> /api/drafts
app.use("/api/emails", draftsRoute({ sessionStore }));    // -> /api/emails/drafts

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
