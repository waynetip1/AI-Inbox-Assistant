// server/routes/compose.js
import express from "express";
import { providerForTier } from "../llmProvider.js";

/** Strip any leading Subject: line(s) the model may emit */
function stripSubject(text = "") {
  return String(text).replace(/^(?:\s*Subject\s*:\s*.*\n)+/i, "").replace(/^\s*\n+/, "").trimStart();
}

/** Build a clear prompt for the model */
function buildPrompt({ original, subject, style, draft, instructions }) {
  const styleLine = style ? `Tone/style: ${style}.` : "Tone/style: professional.";
  if (draft && instructions) {
    return [
      "You are an expert email editor.",
      styleLine,
      "Revise the DRAFT reply below to the ORIGINAL email, following the author's instructions.",
      "Output ONLY the improved reply body. Do not include a “Subject:” line. Do not quote the original.",
      "",
      "ORIGINAL EMAIL:",
      original,
      "",
      "DRAFT REPLY:",
      draft,
      "",
      "AUTHOR INSTRUCTIONS:",
      instructions,
    ].join("\n");
  }
  // Fresh compose
  return [
    "You are an expert email assistant.",
    styleLine,
    "Write a concise, clear reply to the ORIGINAL email. Output ONLY the reply body. Do not include a “Subject:” line. Do not quote the original.",
    subject ? `Subject of thread: ${subject}` : "",
    "",
    "ORIGINAL EMAIL:",
    original,
  ].join("\n");
}

async function callProvider({ original, subject, style, draft, instructions }) {
  const tier = "free"; // default; swap to 'pro' for pro users
  const provider = providerForTier(tier);

  const prompt = buildPrompt({ original, subject, style, draft, instructions });

  // Try provider-specific APIs first; fall back to a generic completion
  if (provider?.composeReply) {
    const { reply, usage } = await provider.composeReply({ original, subject, style, draft, instructions });
    return { reply: stripSubject(reply || ""), usage: usage || {} };
  }

  if (provider?.chat) {
    const { text, usage } = await provider.chat([
      { role: "system", content: "You write excellent email replies; never include a Subject line or quoted text." },
      { role: "user", content: prompt },
    ]);
    return { reply: stripSubject(text || ""), usage: usage || {} };
  }

  // Generic minimal fallback using OpenAI SDK v4 if available
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  try {
    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const resp = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "You write excellent email replies; never include a Subject line or quoted text." },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
    });
    const reply = resp?.choices?.[0]?.message?.content || "";
    return { reply: stripSubject(reply), usage: { provider: "openai", model } };
  } catch (e) {
    throw new Error("No available LLM provider for compose; configure providerForTier or OPENAI_API_KEY.");
  }
}

export default function composeRoute({ sessionStore }) {
  const router = express.Router();

  // POST /compose/reply  (mount at /api/emails or /api)
  router.post("/reply", async (req, res) => {
    try {
      const sessionId = req.query.session?.toString() || "TEST123";
      const session = sessionStore[sessionId];
      if (!session) return res.status(401).json({ ok: false, error: "NO_SESSION" });

      const original = (req.body?.original || "").toString().trim();
      const subject = (req.body?.subject || "").toString();
      const style = (req.body?.style || "professional").toString();
      const draft = (req.body?.draft || "").toString().trim();
      const instructions = (req.body?.instructions || "").toString().trim();

      if (original.length < 10) {
        return res.status(400).json({ ok: false, error: "NO_ORIGINAL", message: "Original email text is required." });
      }

      const { reply, usage } = await callProvider({ original, subject, style, draft, instructions });

      res.setHeader("Access-Control-Expose-Headers", "X-Compose-Provider");
      res.setHeader("X-Compose-Provider", usage?.provider || "llm");
      return res.json({ ok: true, reply, usage });
    } catch (err) {
      console.error("compose/reply error:", err);
      return res.status(500).json({ ok: false, error: "COMPOSE_FAILED", message: err.message });
    }
  });

  return router;
}
