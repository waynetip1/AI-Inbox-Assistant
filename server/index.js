const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// ✅ Allow frontend connection
app.use(cors({
  origin: 'http://localhost:5173',
  methods: ['GET'],
  credentials: true,
}));

app.use(express.json());

// 📈 Stats route (only /api/stats with range=1d)
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
