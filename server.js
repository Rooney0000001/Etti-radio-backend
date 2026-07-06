// ============================================
// ETTI RADIO — LIVE LINK BACKEND
// ============================================
// Two jobs:
//   1. Producers use admin.html to save the current live Facebook video link
//   2. The main website fetches that link to show it inline
// ============================================

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'etti2026';

// ---------- Database ----------
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

const LiveStatusSchema = new mongoose.Schema({
  liveUrl: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now }
});

const LiveStatus = mongoose.model('LiveStatus', LiveStatusSchema);

// Ensure there's always exactly one status document
async function getOrCreateStatus() {
  let status = await LiveStatus.findOne();
  if (!status) {
    status = await LiveStatus.create({ liveUrl: '' });
  }
  return status;
}

// ---------- Routes ----------

// Public: the website calls this to check if we're live
app.get('/api/live', async (req, res) => {
  try {
    const status = await getOrCreateStatus();
    res.json({ liveUrl: status.liveUrl, updatedAt: status.updatedAt });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch live status' });
  }
});

// Protected: producers use this (via admin.html) to update the link
app.post('/api/live', async (req, res) => {
  try {
    const { liveUrl, password } = req.body;

    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Wrong password' });
    }

    const status = await getOrCreateStatus();
    status.liveUrl = (liveUrl || '').trim();
    status.updatedAt = new Date();
    await status.save();

    res.json({ success: true, liveUrl: status.liveUrl });
  } catch (err) {
    res.status(500).json({ error: 'Could not update live status' });
  }
});

app.get('/', (req, res) => {
  res.send('ETTI Radio backend is running. Visit /admin.html to manage the live link.');
});

app.listen(PORT, () => {
  console.log(`ETTI Radio backend running on port ${PORT}`);
});
