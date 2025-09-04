// server/middleware/requireSession.js
const { google } = require('googleapis');
const sessionStore = require('../sessionStore');
const { db } = require('../lib/firebaseAdmin');

function createOAuthClient(tokens) {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  if (tokens) oauth2.setCredentials(tokens);
  return oauth2;
}

function getFromStore(sessionId) {
  return typeof sessionStore.get === 'function'
    ? sessionStore.get(sessionId)
    : sessionStore[sessionId];
}

function setInStore(sessionId, value) {
  if (typeof sessionStore.set === 'function') {
    sessionStore.set(sessionId, value);
  } else {
    sessionStore[sessionId] = value;
  }
}

async function hydrateFromFirestore(sessionId) {
  const snap = await db.collection('userTokens').doc(sessionId).get();
  if (!snap.exists) return null;
  const doc = snap.data();
  const patch = {
    tokens: doc.tokens,
    userEmail: doc.userEmail || null,
    hydratedAt: Date.now(),
  };
  const existing = getFromStore(sessionId) || {};
  setInStore(sessionId, { ...existing, ...patch });
  return getFromStore(sessionId);
}

module.exports = function requireSession() {
  return async (req, res, next) => {
    const session = String(req.query.session || '').trim();
    if (!session) return res.status(401).json({ error: 'Invalid or missing session token.' });

    // allow mock passthrough for TEST123 (no Gmail needed)
    if (session === 'TEST123') {
      req.sessionId = session;
      req.sessionData = getFromStore(session) || {};
      return next();
    }

    try {
      let data = getFromStore(session);
      if (!data?.tokens) {
        data = await hydrateFromFirestore(session);
      }
      if (!data?.tokens) {
        return res.status(401).json({ error: 'Invalid or missing session token.' });
      }

      req.sessionId = session;
      req.sessionData = data;
      req.oauth2Client = createOAuthClient(data.tokens); // optional convenience
      return next();
    } catch (e) {
      console.error('requireSession error:', e);
      return res.status(500).json({ error: 'Session hydration failed' });
    }
  };
};
