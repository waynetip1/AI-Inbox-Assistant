// server/routes/sync.js
console.log('✅ routes/sync.js loaded');

const express = require('express');
const { google } = require('googleapis');
const { db, Timestamp } = require('../lib/firebaseAdmin');
const sessionStore = require('../sessionStore');

const router = express.Router();
const DEBUG = true;

// ---------- helpers ----------
function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}
function makeOAuth2(tokens) {
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials(tokens);
  return oauth2Client;
}

// Hydrate tokens from Firestore if missing in memory
async function getSessionDataHydrated(sessionId) {
  // 1) in-memory
  let data =
    typeof sessionStore.get === 'function'
      ? (sessionStore.get(sessionId) || null)
      : (sessionStore[sessionId] || null);
  if (data && (data.tokens || data.oauth2Client)) return data;

  // 2) Firestore
  try {
    const snap = await db.collection('userTokens').doc(sessionId).get();
    if (snap.exists) {
      const doc = snap.data(); // { tokens, userEmail, updatedAt }
      const merged = { ...(data || {}), tokens: doc.tokens, userEmail: doc.userEmail, hydratedAt: Date.now() };
      if (typeof sessionStore.set === 'function') {
        sessionStore.set(sessionId, merged);
      } else {
        sessionStore[sessionId] = merged;
      }
      return merged;
    }
  } catch (e) {
    if (DEBUG) console.warn('⚠️ token hydration failed:', e.message);
  }
  return data; // might be null
}

// ---------- routes ----------

// Ping to verify router mount
router.get('/sync/ping', (_req, res) => {
  res.json({ ok: true, route: '/api/sync/ping' });
});

// GET /api/sync/init?session=XXX
// Fetch current Gmail historyId and store it in Firestore.
router.get('/sync/init', async (req, res) => {
  const { session } = req.query;

  try {
    const sessionData = await getSessionDataHydrated(session);
    if (!sessionData || (!sessionData.tokens && !sessionData.oauth2Client)) {
      return res.status(401).json({ error: 'Invalid or missing session token.' });
    }

    // mock short-circuit
    if (session === 'TEST123') {
      await db.collection('syncState').doc(session).set({
        userId: 'mock-user',
        lastHistoryId: 'MOCK_HISTORY_ID',
        lastInitAt: Timestamp.now(),
        lastScanAt: null,
      }, { merge: true });

      return res.json({ ok: true, mock: true, msg: 'Stored mock historyId' });
    }

    const oauth2Client = sessionData.oauth2Client || makeOAuth2(sessionData.tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // users.getProfile returns the current historyId
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const historyId = String(profile?.data?.historyId || '');

    if (!historyId) {
      return res.status(500).json({ ok: false, error: 'No historyId returned by Gmail' });
    }

    await db.collection('syncState').doc(session).set({
      userId: 'me',
      lastHistoryId: historyId,
      lastInitAt: Timestamp.now(),
      lastScanAt: null,
    }, { merge: true });

    if (DEBUG) console.log(`🔖 Stored historyId=${historyId} for session=${session}`);

    return res.json({ ok: true, historyId });
  } catch (e) {
    console.error('✕ /api/sync/init error:', e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// GET /api/sync/state?session=XXX
// Debug endpoint: read the stored sync state.
router.get('/sync/state', async (req, res) => {
  const { session } = req.query;
  try {
    const snap = await db.collection('syncState').doc(session).get();
    if (!snap.exists) {
      return res.status(404).json({ ok: false, error: 'No sync state found' });
    }
    const data = snap.data();
    return res.json({
      ok: true,
      state: {
        ...data,
        lastInitAt: data?.lastInitAt?.toDate?.().toISOString?.() || null,
        lastScanAt: data?.lastScanAt?.toDate?.().toISOString?.() || null,
      }
    });
  } catch (e) {
    console.error('✕ /api/sync/state error:', e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

module.exports = router;
