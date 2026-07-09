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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GNEWS_API_KEY = process.env.GNEWS_API_KEY;

// ---------- Database ----------
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

const LiveStatusSchema = new mongoose.Schema({
  liveUrl: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now }
});

const LiveStatus = mongoose.model('LiveStatus', LiveStatusSchema);

// ---------- Blog Posts ----------
const PostSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  imageUrl: { type: String, default: '' },
  category: { type: String, enum: ['manual', 'auto'], default: 'manual' },
  sourceName: { type: String, default: '' }, // e.g. "GNews" for auto posts
  sourceUrl: { type: String, default: '' },  // link to original article, for auto posts
  createdAt: { type: Date, default: Date.now }
});

const Post = mongoose.model('Post', PostSchema);

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
  res.send('ETTI Radio backend is running. Visit /admin.html to manage the live link, or /blog-admin.html to manage blog posts.');
});

// ---------- Blog Routes ----------

// Public: list all posts, newest first
app.get('/api/posts', async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 }).limit(100);
    res.json({ posts });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch posts' });
  }
});

// Public: get a single post
app.get('/api/posts/:id', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json({ post });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch post' });
  }
});

// Protected: manually create a post
app.post('/api/posts', async (req, res) => {
  try {
    const { title, content, imageUrl, password } = req.body;

    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Wrong password' });
    }
    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    const post = await Post.create({
      title: title.trim(),
      content: content.trim(),
      imageUrl: (imageUrl || '').trim(),
      category: 'manual'
    });

    res.json({ success: true, post });
  } catch (err) {
    res.status(500).json({ error: 'Could not create post' });
  }
});

// Protected: edit a post
app.put('/api/posts/:id', async (req, res) => {
  try {
    const { title, content, imageUrl, password } = req.body;

    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Wrong password' });
    }

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    if (title !== undefined) post.title = title.trim();
    if (content !== undefined) post.content = content.trim();
    if (imageUrl !== undefined) post.imageUrl = imageUrl.trim();
    await post.save();

    res.json({ success: true, post });
  } catch (err) {
    res.status(500).json({ error: 'Could not update post' });
  }
});

// Protected: delete a post
app.delete('/api/posts/:id', async (req, res) => {
  try {
    const { password } = req.body;

    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Wrong password' });
    }

    await Post.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete post' });
  }
});

app.listen(PORT, () => {
  console.log(`ETTI Radio backend running on port ${PORT}`);
});

// ============================================
// AUTOMATIC AI NEWS SYSTEM
// ============================================
// Every 30 minutes: fetch fresh Kenya + world headlines from GNews (free tier),
// ask Gemini to write each one up as a short blog post, and save any that
// aren't already in the database (checked by sourceUrl).
// ============================================

async function fetchHeadlines() {
  if (!GNEWS_API_KEY) {
    console.log('GNEWS_API_KEY not set — skipping auto news fetch');
    return [];
  }

  const queries = [
    `https://gnews.io/api/v4/top-headlines?category=general&lang=en&country=ke&max=5&apikey=${GNEWS_API_KEY}`,
    `https://gnews.io/api/v4/top-headlines?category=world&lang=en&max=5&apikey=${GNEWS_API_KEY}`
  ];

  let articles = [];
  for (const url of queries) {
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.articles) articles = articles.concat(data.articles);
    } catch (err) {
      console.error('Error fetching headlines:', err.message);
    }
  }
  return articles;
}

async function writeWithGemini(article) {
  if (!GEMINI_API_KEY) {
    console.log('GEMINI_API_KEY not set — skipping AI writing');
    return null;
  }

  const prompt = `Write a short, clear news blog post (120-180 words) for a radio station website, based on this headline and description. Keep it factual and neutral. Do not invent details not in the source. Respond with only the post body text, no title, no markdown.

Headline: ${article.title}
Description: ${article.description || ''}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ? text.trim() : null;
  } catch (err) {
    console.error('Error calling Gemini:', err.message);
    return null;
  }
}

async function runAutoNewsCycle() {
  console.log('Checking for fresh news...');
  const articles = await fetchHeadlines();

  for (const article of articles) {
    if (!article.url || !article.title) continue;

    // Skip if we've already posted this exact article
    const existing = await Post.findOne({ sourceUrl: article.url });
    if (existing) continue;

    const written = await writeWithGemini(article);
    if (!written) continue;

    await Post.create({
      title: article.title,
      content: written,
      imageUrl: article.image || '',
      category: 'auto',
      sourceName: article.source?.name || 'News wire',
      sourceUrl: article.url
    });

    console.log('Auto-posted:', article.title);
  }
}

// Run once on startup, then every 30 minutes
if (GEMINI_API_KEY && GNEWS_API_KEY) {
  runAutoNewsCycle();
  setInterval(runAutoNewsCycle, 30 * 60 * 1000);
} else {
  console.log('Auto news system idle — GEMINI_API_KEY and/or GNEWS_API_KEY not set yet.');
}
