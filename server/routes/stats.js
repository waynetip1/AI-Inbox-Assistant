const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const sessionStore = require('../sessionStore');

// ✅ Add mock session for testing deployed frontend
sessionStore.set('TEST123', {
  stats: {
    inbox: 42,
    sent: 12,
    drafts: 3,
    spam: 7,
    unread: 19,
    starred: 5,
    important: 2,
    subscriptions: 11,
    total: 89
  },
  tokens: { access_token: 'mock', expiry_date: Date.now() + 100000 } // dummy token
});

const MAX_PAGES_FOR_FULL_SCAN = 5;

router.get('/stats', async (req, res) => {
  try {
    console.log('📥 Incoming /api/stats request');
    const { range = '1d', session } = req.query;
    console.log('🔐 Session ID:', session, '| Range:', range);

    const sessionData = sessionStore.get(session);
    if (!sessionData || !sessionData.tokens) {
      return res.status(401).json({ error: 'Invalid or missing session token.' });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials(sessionData.tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Stream setup
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const dateQuery = `newer_than:${range}`;
    const statQueries = [
      ['total', ''],
      ['unread', 'is:unread'],
      ['inbox', 'label:inbox'],
      ['sent', 'label:sent'],
      ['drafts', 'label:drafts'],
      ['spam', 'label:spam'],
      ['starred', 'is:starred'],
      ['important', 'is:important'],
      ['promotions', 'category:promotions'],
      ['social', 'category:social'],
      ['attachments', 'has:attachment'],
    ];

    const stats = {};
    const totalPages = statQueries.length;
    let pagesFetched = 0;

    for (const [label, query] of statQueries) {
      const fullQuery = `${query} ${dateQuery}`.trim();
      console.log(`📨 Fetching ${label}: ${fullQuery}`);

      let count = 0;
      let seenPages = 0;
      let nextPageToken = null;
      let firstPageCount = 0;
      let lastPageCount = 0;

      do {
        const gmailRes = await gmail.users.messages.list({
          userId: 'me',
          q: fullQuery,
          maxResults: 500,
          pageToken: nextPageToken || undefined,
        });

        const msgs = gmailRes.data.messages || [];
        if (seenPages === 0) firstPageCount = msgs.length;
        lastPageCount = msgs.length;

        count += msgs.length;
        nextPageToken = gmailRes.data.nextPageToken;
        seenPages++;
      } while (nextPageToken);

      if (range !== '1d' && firstPageCount === 500) {
        const estimated = (seenPages - 1) * 500 + lastPageCount;
        stats[label] = `~${estimated}`;
      } else {
        stats[label] = count;
      }

      pagesFetched++;
      res.write(`data: ${JSON.stringify({ progress: { pagesFetched, totalPages } })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ range, stats })}\n\n`);
    res.end();
  } catch (err) {
    console.error('❌ Error in /api/stats:', err);
    res.write(`data: ${JSON.stringify({ error: 'Server error while fetching stats.' })}\n\n`);
    res.end();
  }
});

module.exports = router;
