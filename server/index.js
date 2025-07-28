const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

const sessionStore = require('./sessionStore');

// ✅ Inject mock session ONLY HERE to ensure global availability
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
  tokens: { access_token: 'mock', expiry_date: Date.now() + 100000 }
});

// ✅ Allow frontend connection
app.use(cors({
  origin: ['http://localhost:5173', 'https://ai-inbox-assistant.vercel.app'],
  methods: ['GET'],
  credentials: true,
}));

app.use(express.json());

// 📈 Stats route
const statsRoutes = require('./routes/stats');
app.use('/api', statsRoutes);

// 🔐 Google OAuth route
const authRoutes = require('./routes/auth');
app.use('/auth', authRoutes);

// Root check
app.get('/', (req, res) => {
  res.send('✅ AI Inbox Assistant backend is running!');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
