const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const crypto = require('crypto');
const sessionStore = require('../sessionStore');

// 🧠 Create OAuth2 client
function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// 🔐 Redirect to Google consent screen
router.get('/google', (req, res) => {
  const oauth2Client = createOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    prompt: 'consent',
  });
  res.redirect(url);
});

// 📨 OAuth callback after consent
router.get('/google/callback', async (req, res) => {
  try {
    const oauth2Client = createOAuthClient();
    const { code } = req.query;

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 5,
      q: 'is:unread',
    });

    const summaries = (response.data.messages || []).map(msg => ({
      id: msg.id,
    }));

    const sessionId = crypto.randomUUID();

    sessionStore.set(sessionId, {
      tokens,
      summaries,
    });

    console.log(`✅ Session stored for ID: ${sessionId}`);
    res.redirect(`http://localhost:5173/?session=${sessionId}`);
  } catch (err) {
    console.error('❌ Google auth error:', err);
    res.status(500).send('Authentication failed');
  }
});

module.exports = router;
