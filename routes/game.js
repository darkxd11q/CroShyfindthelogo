// routes/game.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');

const router = express.Router();

// ---------------------------------------------------------------
// GET /api/game/active
// Returns only what a player needs to see the puzzle. The logo's
// coordinates and tolerance radius are intentionally left out.
// ---------------------------------------------------------------
router.get('/active', (req, res) => {
  const row = db.prepare('SELECT * FROM images WHERE is_active = 1 LIMIT 1').get();
  if (!row) return res.status(404).json({ error: 'No puzzle is live right now.' });

  res.json({
    id: row.id,
    url: `/uploads/${row.filename}`,
    width: row.width,
    height: row.height
  });
});

const guessLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Slow down a little and try again in a moment.' }
});

// ---------------------------------------------------------------
// POST /api/game/:id/guess
// The ONLY place the click is checked against the real logo
// location. That comparison happens entirely on the server; the
// client never receives logo_x, logo_y, or tolerance.
// ---------------------------------------------------------------
router.post('/:id/guess', guessLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM images WHERE id = ? AND is_active = 1').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Puzzle not found.' });
  if (row.logo_x === null || row.logo_y === null) {
    return res.status(400).json({ error: 'This puzzle has no target set yet.' });
  }

  const { x, y } = req.body || {};
  const nx = Number(x);
  const ny = Number(y);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
    return res.status(400).json({ error: 'x and y must be numbers.' });
  }

  const distance = Math.hypot(nx - row.logo_x, ny - row.logo_y);
  const correct = distance <= row.tolerance;

  res.json({ correct });
});

// ---------------------------------------------------------------
// Likes / dislikes
// One vote per (image, clientId). clientId is a random id the
// frontend generates and stores in localStorage - good enough to
// stop accidental double-votes without requiring an account.
// ---------------------------------------------------------------
function voteCounts(imageId) {
  const counts = db.prepare(
    `SELECT
       SUM(CASE WHEN vote_type = 'like' THEN 1 ELSE 0 END) AS likes,
       SUM(CASE WHEN vote_type = 'dislike' THEN 1 ELSE 0 END) AS dislikes
     FROM votes WHERE image_id = ?`
  ).get(imageId);
  return { likes: counts.likes || 0, dislikes: counts.dislikes || 0 };
}

router.get('/:id/votes', (req, res) => {
  const image = db.prepare('SELECT id FROM images WHERE id = ?').get(req.params.id);
  if (!image) return res.status(404).json({ error: 'Puzzle not found.' });

  const clientId = req.query.clientId;
  const counts = voteCounts(image.id);
  let yourVote = null;
  if (clientId) {
    const existing = db.prepare(
      'SELECT vote_type FROM votes WHERE image_id = ? AND client_id = ?'
    ).get(image.id, clientId);
    if (existing) yourVote = existing.vote_type;
  }
  res.json({ ...counts, yourVote });
});

const voteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/:id/vote', voteLimiter, (req, res) => {
  const image = db.prepare('SELECT id FROM images WHERE id = ?').get(req.params.id);
  if (!image) return res.status(404).json({ error: 'Puzzle not found.' });

  const { type, clientId } = req.body || {};
  if (!['like', 'dislike'].includes(type)) {
    return res.status(400).json({ error: "type must be 'like' or 'dislike'." });
  }
  if (typeof clientId !== 'string' || clientId.length < 8 || clientId.length > 100) {
    return res.status(400).json({ error: 'A valid clientId is required.' });
  }

  const existing = db.prepare(
    'SELECT * FROM votes WHERE image_id = ? AND client_id = ?'
  ).get(image.id, clientId);

  if (existing && existing.vote_type === type) {
    // Clicking the same vote again removes it (toggle off)
    db.prepare('DELETE FROM votes WHERE id = ?').run(existing.id);
  } else if (existing) {
    // Switching from like <-> dislike
    db.prepare('UPDATE votes SET vote_type = ? WHERE id = ?').run(type, existing.id);
  } else {
    db.prepare(
      'INSERT INTO votes (image_id, client_id, vote_type) VALUES (?, ?, ?)'
    ).run(image.id, clientId, type);
  }

  const counts = voteCounts(image.id);
  const fresh = db.prepare(
    'SELECT vote_type FROM votes WHERE image_id = ? AND client_id = ?'
  ).get(image.id, clientId);

  res.json({ ...counts, yourVote: fresh ? fresh.vote_type : null });
});

// ---------------------------------------------------------------
// Comments - no login, just a name and a message
// ---------------------------------------------------------------
router.get('/:id/comments', (req, res) => {
  const image = db.prepare('SELECT id FROM images WHERE id = ?').get(req.params.id);
  if (!image) return res.status(404).json({ error: 'Puzzle not found.' });

  const rows = db.prepare(
    'SELECT id, name, comment, created_at FROM comments WHERE image_id = ? ORDER BY created_at DESC LIMIT 200'
  ).all(image.id);
  res.json(rows);
});

const commentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'You are posting comments too quickly.' }
});

router.post('/:id/comments', commentLimiter, (req, res) => {
  const image = db.prepare('SELECT id FROM images WHERE id = ?').get(req.params.id);
  if (!image) return res.status(404).json({ error: 'Puzzle not found.' });

  let { name, comment } = req.body || {};
  name = (name || '').toString().trim();
  comment = (comment || '').toString().trim();

  if (!name || !comment) {
    return res.status(400).json({ error: 'Name and comment are both required.' });
  }
  if (name.length > 50) return res.status(400).json({ error: 'Name must be 50 characters or fewer.' });
  if (comment.length > 500) return res.status(400).json({ error: 'Comment must be 500 characters or fewer.' });

  const info = db.prepare(
    'INSERT INTO comments (image_id, name, comment) VALUES (?, ?, ?)'
  ).run(image.id, name, comment);

  const row = db.prepare('SELECT id, name, comment, created_at FROM comments WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
});

module.exports = router;
