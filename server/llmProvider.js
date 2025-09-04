// server/llmProvider.js
// Abstraction over Gemini (Free) and OpenAI (Pro/AutoPilot)

import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * @typedef {Object} Provider
 * @property {string} name
 * @property {(items: Array<{id:string,text:string}> , opts?: {purpose?: string}) => Promise<{summaries: Array<{id:string, summary:string}>, usage?: {promptTokens?: number, completionTokens?: number}}>} summarize
 */

function makeGemini() {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) throw new Error("Missing GOOGLE_GENAI_API_KEY");
  const genAI = new GoogleGenerativeAI(apiKey);
  // Pick a cheap, fast model for Free tier
  // Use a stable Flash(-Lite) name available in your project
  const modelName =
    process.env.GEMINI_MODEL ||
    "gemini-2.0-flash-lite-preview-02-05"; // sensible default
  const model = genAI.getGenerativeModel({ model: modelName });
  return model;
}

function makeOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY");
  return new OpenAI({ apiKey: key });
}

/**
 * @param {"gemini"|"openai"} which
 * @returns {Provider}
 */
export function getProvider(which = "gemini") {
  if ((which || "").toLowerCase() === "gemini") {
    const model = makeGemini();
    return {
      name: "gemini",
      /**
       * @param {{id:string,text:string}[]} items
       */
      async summarize(items, opts = {}) {
        const sys =
          "You summarize email messages for a Gmail assistant. Return concise 2-3 bullet summaries, highlight key ask, deadline, and next step. No greeting.";
        const prompts = items.map(({ id, text }) => ({
          id,
          parts: [
            { text: sys },
            {
              text:
                `Summarize the following email:\n` +
                `---\n${text}\n---\n` +
                `Return:\n• 2–3 bullets\n• Priority (Low/Med/High)\n• Suggested action (1 line)`,
            },
          ],
        }));

        // Gemini doesn't support multi-request batch in one call; do sequential to keep it simple
        const summaries = [];
        for (const p of prompts) {
          // Using "generateContent" single-shot for speed/cost
          const result = await model.generateContent({ contents: [{ role: "user", parts: p.parts }] });
          const text = result.response.text();
          summaries.push({ id: p.id, summary: text });
        }

        // Usage tokens are not exposed consistently; return undefined for now.
        return { summaries, usage: {} };
      },
    };
  }

  // OpenAI fallback
  const openai = makeOpenAI();
  return {
    name: "openai",
    async summarize(items, opts = {}) {
      const sys =
        "You summarize email messages for a Gmail assistant. Return concise 2-3 bullet summaries, highlight key ask, deadline, and next step. No greeting.";
      const messages = [
        { role: "system", content: sys },
        {
          role: "user",
          content:
            items
              .map(
                (it, i) =>
                  `Email ${i + 1} (id=${it.id}):\n` +
                  it.text +
                  `\n\nReturn 2–3 bullets, Priority (Low/Med/High), Suggested action.`
              )
              .join("\n\n---\n\n"),
        },
      ];

      const resp = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-3.5-turbo",
        messages,
        temperature: 0.2,
      });

      const out = resp.choices?.[0]?.message?.content || "";
      // naive split back per email; for higher fidelity we could ask the model to JSON, but keep it minimal here
      const chunks = out.split(/(?:^|\n)---\n?/).filter(Boolean);
      const summaries = items.map((it, idx) => ({
        id: it.id,
        summary: chunks[idx] || out,
      }));

      const usage = {
        promptTokens: resp.usage?.prompt_tokens ?? undefined,
        completionTokens: resp.usage?.completion_tokens ?? undefined,
      };
      return { summaries, usage };
    },
  };
}

/**
 * Helper: choose provider for Free vs Pro
 * @param {"free"|"pro"|"autopilot"} tier
 */
export function providerForTier(tier = "free") {
  if (tier === "free") {
    const which = (process.env.FREE_TIER_PROVIDER || "gemini").toLowerCase();
    return getProvider(which);
  }
  // default to OpenAI for paid until we wire a blend
  return getProvider("openai");
}
