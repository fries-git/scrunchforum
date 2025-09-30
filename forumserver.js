// forumserver.js — Express-based forum server with per-user reaction tracking
const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'posts.json');
const EMOJIS = ["Happy","Neutral","Sad","Big Smile","Yikes","Wink","Think","Tounge","Lol","Mad","Roll","Cool"];

const app = express();
let posts = [];

// Middleware
app.use(express.json()); // parse JSON bodies
app.use(express.static(path.join(__dirname, 'public'))); // serve static files

// Load posts from file
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf8').trim();
    posts = raw ? JSON.parse(raw) : [];
    posts.forEach(p => {
      if (!p.reactions) p.reactions = Object.fromEntries(EMOJIS.map(e => [e, 0]));
      if (!p.reactedBy) p.reactedBy = {};
    });
    console.log(`Loaded ${posts.length} posts from ${DATA_FILE}`);
  } else {
    console.log('No posts.json found, starting empty.');
  }
} catch (err) {
  console.error('Failed to load posts.json:', err);
  posts = [];
}

// Save helper
function savePosts() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(posts, null, 2));
    console.log(`Saved ${posts.length} posts to ${DATA_FILE}`);
  } catch (err) {
    console.error('Error writing posts.json:', err);
  }
}

// Routes

// GET all posts
app.get('/posts', (req, res) => {
  res.json(posts.map(p => ({
    ...p,
    reactions: p.reactions || Object.fromEntries(EMOJIS.map(e => [e, 0])),
    reactedBy: p.reactedBy || {}
  })));
});

// GET single post
app.get('/posts/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const post = posts.find(p => p.id === id);
  if (!post) return res.status(404).json({ error: 'not found' });
  post.reactions = post.reactions || Object.fromEntries(EMOJIS.map(e => [e, 0]));
  post.reactedBy = post.reactedBy || {};
  res.json(post);
});

// POST for creating, deleting, reacting, or resetting reactions
app.post('/posts', (req, res) => {
  const data = req.body;
  if (!data) return res.status(400).json({ error: 'No JSON body provided' });

  // DELETE logic
  if (typeof data.delete !== 'undefined') {
    const delId = parseInt(data.delete, 10);
    if (delId === 0) {
      posts = [];
      savePosts();
      return res.json({ message: 'All posts deleted' });
    }
    const index = posts.findIndex(p => p.id === delId);
    if (index === -1) return res.status(404).json({ error: `Post ${delId} not found` });
    const removed = posts.splice(index, 1)[0];
    savePosts();
    return res.json({ message: `Post ${delId} deleted`, post: removed });
  }

  // REACT logic
  if (data.react && data.emoji) {
    if (!data.user) return res.status(400).json({ error: 'user required for reactions' });
    const user = String(data.user);
    const id = parseInt(data.react, 10);
    const post = posts.find(p => p.id === id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (!EMOJIS.includes(data.emoji)) return res.status(400).json({ error: 'Invalid emoji' });

    post.reactions = post.reactions || Object.fromEntries(EMOJIS.map(e => [e, 0]));
    post.reactedBy = post.reactedBy || {};

    if (!post.reactedBy[user]) post.reactedBy[user] = [];
    if (post.reactedBy[user].includes(data.emoji)) {
      return res.status(400).json({ error: `User already reacted with ${data.emoji}` });
    }

    post.reactedBy[user].push(data.emoji);
    post.reactions[data.emoji]++;
    savePosts();
    return res.json({ message: `Reacted ${data.emoji} to post ${id}`, post });
  }

  // RESET reactions
  if (typeof data.resetReactions !== 'undefined') {
    const resetId = parseInt(data.resetReactions, 10);
    if (resetId === 0) {
      posts.forEach(p => { p.reactions = Object.fromEntries(EMOJIS.map(e => [e, 0])); p.reactedBy = {}; });
      savePosts();
      return res.json({ message: 'All reactions reset' });
    }
    const post = posts.find(p => p.id === resetId);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    post.reactions = Object.fromEntries(EMOJIS.map(e => [e, 0]));
    post.reactedBy = {};
    savePosts();
    return res.json({ message: `Reactions reset for post ${resetId}`, post });
  }

  // CREATE post
  if (!data.author || !data.content) return res.status(400).json({ error: 'author and content required' });
  const id = posts.length ? posts[posts.length - 1].id + 1 : 1;
  const post = {
    id,
    author: String(data.author),
    content: String(data.content),
    createdAt: new Date().toISOString(),
    reactions: Object.fromEntries(EMOJIS.map(e => [e, 0])),
    reactedBy: {}
  };
  posts.push(post);
  savePosts();
  res.status(201).json(post);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
