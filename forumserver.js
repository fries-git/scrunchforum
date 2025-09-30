// forumserver.js — forum server with per-user reaction tracking
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express')

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'posts.json');
const EMOJIS = ["Happy","Neutral","Sad","Big Smile","Yikes","Wink","Think","Tounge","Lol","Mad","Roll","Cool"];
const app = express();
app.use(express.static('public'));
let posts = [];

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Load posts from file
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf8').trim();
    posts = raw ? JSON.parse(raw) : [];
    // Ensure all posts have reactions & reactedBy
    posts.forEach(p => {
      if (!p.reactions) p.reactions = Object.fromEntries(EMOJIS.map(e => [e, 0]));
      if (!p.reactedBy) p.reactedBy = {};
    });
    console.log(`Loaded ${posts.length} posts from ${DATA_FILE}`);
  } else {
    console.log('No posts.json found, starting empty posts.');
  }
} catch (err) {
  console.error('Failed to load posts.json, starting empty. Error:', err);
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

// JSON response helper with CORS
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const now = new Date().toISOString();
  console.log(`[${now}] ${req.method} ${req.url}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // GET /posts
  if (pathname === '/posts' && req.method === 'GET') {
    const normalized = posts.map(p => {
      if (!p.reactions) p.reactions = Object.fromEntries(EMOJIS.map(e => [e, 0]));
      if (!p.reactedBy) p.reactedBy = {};
      return p;
    });
    return sendJSON(res, 200, normalized);
  }

  // GET /posts/:id
  if (pathname.startsWith('/posts/') && req.method === 'GET') {
    const id = parseInt(pathname.slice('/posts/'.length), 10);
    if (Number.isNaN(id)) return sendJSON(res, 400, { error: 'invalid id' });
    const post = posts.find(p => p.id === id);
    if (!post) return sendJSON(res, 404, { error: 'not found' });
    if (!post.reactions) post.reactions = Object.fromEntries(EMOJIS.map(e => [e, 0]));
    if (!post.reactedBy) post.reactedBy = {};
    return sendJSON(res, 200, post);
  }

  // POST /posts
  if (pathname === '/posts' && req.method === 'POST') {
    let raw = '';
    let aborted = false;

    req.on('data', chunk => {
      raw += chunk.toString();
      if (raw.length > 1e6) { aborted = true; req.destroy(); }
    });

    req.on('end', () => {
      if (aborted) return;
      console.log('  raw body:', raw);

      let data;
      try { data = raw ? JSON.parse(raw) : null; } 
      catch { return sendJSON(res, 400, { error: 'Invalid JSON' }); }

      // DELETE logic
      if (data && typeof data.delete !== 'undefined') {
        const delId = parseInt(data.delete, 10);
        if (delId === 0) { posts = []; savePosts(); return sendJSON(res,200,{message:'All posts deleted'}); }
        const index = posts.findIndex(p=>p.id===delId);
        if(index===-1) return sendJSON(res,404,{error:`Post ${delId} not found`});
        const removed = posts.splice(index,1)[0]; savePosts();
        return sendJSON(res,200,{message:`Post ${delId} deleted`, post:removed});
      }

      // REACT logic with user tracking
      if (data && data.react && data.emoji) {
        if (!data.user) return sendJSON(res,400,{error:'user required for reactions'});
        const user = String(data.user);
        const id = parseInt(data.react,10);
        const post = posts.find(p=>p.id===id);
        if(!post) return sendJSON(res,404,{error:"Post not found"});
        if(!EMOJIS.includes(data.emoji)) return sendJSON(res,400,{error:"Invalid emoji"});

        if(!post.reactions) post.reactions = Object.fromEntries(EMOJIS.map(e=>[e,0]));
        if(!post.reactedBy) post.reactedBy = {};

        if(!post.reactedBy[user]) post.reactedBy[user] = [];
        if(post.reactedBy[user].includes(data.emoji)){
          return sendJSON(res,400,{error:`User already reacted with ${data.emoji}`});
        }

        post.reactedBy[user].push(data.emoji);
        post.reactions[data.emoji]++;
        savePosts();
        return sendJSON(res,200,{message:`Reacted ${data.emoji} to post ${id}`, post});
      }

      // RESET REACTIONS logic
      if (data && typeof data.resetReactions !== 'undefined') {
        const resetId = parseInt(data.resetReactions, 10);
        if (resetId === 0) {
          posts.forEach(p=>{ 
            p.reactions = Object.fromEntries(EMOJIS.map(e=>[e,0])); 
            p.reactedBy = {};
          });
          savePosts();
          return sendJSON(res,200,{message:"All reactions reset"});
        }
        const post = posts.find(p=>p.id===resetId);
        if(!post) return sendJSON(res,404,{error:"Post not found"});
        post.reactions = Object.fromEntries(EMOJIS.map(e=>[e,0]));
        post.reactedBy = {};
        savePosts();
        return sendJSON(res,200,{message:`Reactions reset for post ${resetId}`, post});
      }

      // CREATE post logic
      if (!data || !data.author || !data.content) return sendJSON(res,400,{error:'author and content required'});
      const id = posts.length ? posts[posts.length-1].id+1 : 1;
      const post = {
        id,
        author: String(data.author),
        content: String(data.content),
        createdAt: new Date().toISOString(),
        reactions: Object.fromEntries(EMOJIS.map(e=>[e,0])),
        reactedBy: {}
      };
      posts.push(post);
      savePosts();
      return sendJSON(res,201,post);
    });

    req.on('error', err => { if (!res.headersSent) sendJSON(res,500,{error:'request error'}); });
    return;
  }

  sendJSON(res,404,{error:'not found'});
});

server.listen(PORT,()=>console.log(`Server running at http://localhost:${PORT}`));