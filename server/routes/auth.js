// server/routes/auth.js
import express from "express";
import { google } from "googleapis";
import { saveSessionToDisk } from "../persist.js";

/** Build OAuth2 client */
function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export default function authRoute({ sessionStore }) {
  const router = express.Router();

  // GET /auth/google?session=SESSION123
  router.get("/google", (req, res) => {
    const sessionId = (req.query.session || "").toString() || "TEST123";

    const oauth2Client = createOAuthClient();
    const scopes = [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ];

    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      prompt: "consent",
      state: sessionId,
    });

    res.redirect(url);
  });

  // GET /auth/google/callback
  router.get("/google/callback", async (req, res) => {
    try {
      const { code, state, debug } = req.query;
      const sessionId = (state || "TEST123").toString();

      const oauth2Client = createOAuthClient();
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      // Fetch basic user profile
      const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
      const me = await oauth2.userinfo.get();
      const user = {
        email: me?.data?.email || "",
        name: me?.data?.name || "",
        picture: me?.data?.picture || "",
      };

      // Save in memory
      sessionStore[sessionId] = { oauth2Client, tokens, user };

      // Persist to disk for auto-rehydrate after server restarts
      saveSessionToDisk(sessionId, { tokens, user });

      // If ?debug=1, show the success page (handy in dev)
      if (String(debug) === "1") {
        res.set("Content-Type", "text/html; charset=utf-8");
        return res.send(`<!doctype html>
<html><body style="font-family: system-ui; padding:24px">
  <h3>✅ Google Auth Successful</h3>
  <p><strong>Session:</strong> ${sessionId}</p>
  <p>Stored tokens for this session.</p>
  <p><a href="/api/debug/session">View server sessions</a></p>
  <p><a href="/api/debug/persisted">View persisted sessions</a></p>
  <p><a href="${(process.env.CLIENT_ORIGIN || "http://localhost:5173")}/?session=${encodeURIComponent(sessionId)}">Return to App</a></p>
</body></html>`);
      }

      // Normal flow: redirect straight to the SPA with the session id
      const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
      return res.redirect(`${clientOrigin}/?session=${encodeURIComponent(sessionId)}`);
    } catch (e) {
      console.error("[/auth/google/callback] error", e);
      return res.status(500).send("Auth failed");
    }
  });

  return router;
}
