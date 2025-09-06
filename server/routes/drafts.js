// server/routes/drafts.js
import express from "express";
import { google } from "googleapis";

/** base64url encode (RFC 4648 §5) */
function b64url(input = "") {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/** Simple RFC-822 builder (text/plain UTF-8) */
function buildRfc822({ to, subject, body }) {
  // Normalize line endings to CRLF per RFC 5322
  const crlf = (s) => String(s || "").replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");

  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
  ].join("\r\n");

  return `${headers}\r\n\r\n${crlf(body || "")}`;
}

export default function draftsRoute({ sessionStore }) {
  const router = express.Router();

  // POST /drafts  (mounted under /api and /api/emails)
  router.post("/drafts", async (req, res) => {
    try {
      const sessionId = (req.query.session || "TEST123").toString();
      const session = sessionStore[sessionId];
      if (!session?.oauth2Client) {
        return res.status(401).json({
          ok: false,
          error: "NO_SESSION",
          message: "Authenticate first at /auth/google?session=YOUR_SESSION_ID",
        });
      }

      const to = (req.body?.to || "").toString().trim();
      const subject = (req.body?.subject || "").toString();
      const body = (req.body?.body || "").toString();
      const threadId = (req.body?.threadId || "").toString().trim() || undefined;

      if (!to) return res.status(400).json({ ok: false, error: "NO_TO", message: "Recipient (to) is required." });
      if (!subject.trim()) return res.status(400).json({ ok: false, error: "NO_SUBJECT", message: "Subject is required." });
      if (body.trim().length < 1) return res.status(400).json({ ok: false, error: "NO_BODY", message: "Body is required." });

      const raw = b64url(buildRfc822({ to, subject, body }));

      const gmail = google.gmail({ version: "v1", auth: session.oauth2Client });
      const { data } = await gmail.users.drafts.create({
        userId: "me",
        requestBody: {
          message: {
            raw,
            ...(threadId ? { threadId } : {}),
          },
        },
      });

      const draftId = data?.id || "";
      const createdThreadId = data?.message?.threadId || threadId || "";
      // Best-effort Gmail URL: if we know the thread, go to it; otherwise open drafts view.
      const gmailUrl = createdThreadId
        ? `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(createdThreadId)}`
        : `https://mail.google.com/mail/u/0/#drafts`;

      res.setHeader(
        "Access-Control-Expose-Headers",
        ["X-Draft-Id", "X-Thread-Id"].join(",")
      );
      if (draftId) res.setHeader("X-Draft-Id", draftId);
      if (createdThreadId) res.setHeader("X-Thread-Id", createdThreadId);

      return res.json({ ok: true, draftId, threadId: createdThreadId, gmailUrl });
    } catch (err) {
      console.error("drafts.create error:", err?.response?.data || err);
      return res.status(500).json({ ok: false, error: "DRAFT_CREATE_FAILED", message: err.message });
    }
  });

  return router;
}
