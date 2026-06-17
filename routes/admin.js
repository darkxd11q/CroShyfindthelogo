// routes/admin.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const sizeOf = require('image-size');

const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------------------------------------------------------------
// Password check: the admin password lives only in process.env
// (loaded from .env) and is compared using a constant-time digest
// comparison so response timing can't leak information about it.
// ---------------------------------------------------------------
function checkPassword(candidate) {
  const real = process.env.ADMIN_PASSWORD || '';
  if (typeof candidate !== 'string' || candidate.length === 0) return false;
  const a = crypto.createHash('sha256').update(candidate).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  return crypto.timingSafeEqual(a, b);
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' }
});

// POST /api/admin/login
router.post('/login', loginLimiter, (req, res) => {
  const { password } = req.body || {};
  if (!checkPassword(password)) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  req.session.isAdmin = true;
  res.json({ success: true });
});

// POST /api/admin/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// GET /api/admin/session  -> tells the frontend whether it's logged in
router.get('/session', (req, res) => {
  res.json({ loggedIn: !!(req.session && req.session.isAdmin) });
});

// Everything below this line requires an authenticated admin session
router.use(requireAdmin);

// ---------------------------------------------------------------
// Image upload
// ---------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});

const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      return cb(new Error('Only PNG, JPEG, WEBP, or GIF images are allowed.'));
    }
    cb(null, true);
  }
});

function serializeAdminImage(row) {
  const counts = db.prepare(
    `SELECT
       SUM(CASE WHEN vote_type = 'like' THEN 1 ELSE 0 END) AS likes,
       SUM(CASE WHEN vote_type = 'dislike' THEN 1 ELSE 0 END) AS dislikes
     FROM votes WHERE image_id = ?`
  ).get(row.id);
  const commentsCount = db.prepare(
    `SELECT COUNT(*) AS n FROM comments WHERE image_id = ?`
  ).get(row.id).n;

  return {
    id: row.id,
    url: `/uploads/${row.filename}`,
    originalName: row.original_name,
    width: row.width,
    height: row.height,
    logoX: row.logo_x,
    logoY: row.logo_y,
    tolerance: row.tolerance,
    isActive: !!row.is_active,
    likes: counts.likes || 0,
    dislikes: counts.dislikes || 0,
    commentsCount,
    createdAt: row.created_at,
    logoSet: row.logo_x !== null && row.logo_y !== null
  };
}

// GET /api/admin/images - list every uploaded puzzle (admin only)
router.get('/images', (req, res) => {
  const rows = db.prepare('SELECT * FROM images ORDER BY created_at DESC').all();
  res.json(rows.map(serializeAdminImage));
});

// POST /api/admin/images - upload a new puzzle image
router.post('/images', (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No image file received.' });

    let dimensions;
    try {
      dimensions = sizeOf(req.file.path);
    } catch (e) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Could not read image dimensions.' });
    }

    const info = db.prepare(
      `INSERT INTO images (filename, original_name, width, height)
       VALUES (?, ?, ?, ?)`
    ).run(req.file.filename, req.file.originalname, dimensions.width, dimensions.height);

    const row = db.prepare('SELECT * FROM images WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(serializeAdminImage(row));
  });
});

// POST /api/admin/images/:id/logo - set (or update) the hidden logo location
router.post('/images/:id/logo', (req, res) => {
  const row = db.prepare('SELECT * FROM images WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Image not found.' });

  const { x, y, tolerance } = req.body || {};
  const nx = Number(x);
  const ny = Number(y);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
    return res.status(400).json({ error: 'x and y must be numbers.' });
  }
  if (nx < 0 || ny < 0 || nx > row.width || ny > row.height) {
    return res.status(400).json({ error: 'Coordinates fall outside the image.' });
  }

  let tol = row.tolerance;
  if (tolerance !== undefined) {
    const nt = Number(tolerance);
    if (!Number.isFinite(nt) || nt < 5 || nt > 300) {
      return res.status(400).json({ error: 'Tolerance must be a number between 5 and 300.' });
    }
    tol = nt;
  }

  db.prepare('UPDATE images SET logo_x = ?, logo_y = ?, tolerance = ? WHERE id = ?')
    .run(nx, ny, tol, row.id);

  const updated = db.prepare('SELECT * FROM images WHERE id = ?').get(row.id);
  res.json(serializeAdminImage(updated));
});

// POST /api/admin/images/:id/activate - make this the puzzle players see
router.post('/images/:id/activate', (req, res) => {
  const row = db.prepare('SELECT * FROM images WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Image not found.' });
  if (row.logo_x === null || row.logo_y === null) {
    return res.status(400).json({ error: 'Set the logo location before activating this image.' });
  }

  db.prepare('UPDATE images SET is_active = 0').run();
  db.prepare('UPDATE images SET is_active = 1 WHERE id = ?').run(row.id);

  const updated = db.prepare('SELECT * FROM images WHERE id = ?').get(row.id);
  res.json(serializeAdminImage(updated));
});

// POST /api/admin/images/:id/deactivate - take the puzzle offline
router.post('/images/:id/deactivate', (req, res) => {
  const row = db.prepare('SELECT * FROM images WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Image not found.' });
  db.prepare('UPDATE images SET is_active = 0 WHERE id = ?').run(row.id);
  const updated = db.prepare('SELECT * FROM images WHERE id = ?').get(row.id);
  res.json(serializeAdminImage(updated));
});

// DELETE /api/admin/images/:id
router.delete('/images/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM images WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Image not found.' });

  db.prepare('DELETE FROM images WHERE id = ?').run(row.id); // cascades votes + comments

  const filePath = path.join(UPLOAD_DIR, row.filename);
  fs.unlink(filePath, () => {}); // best-effort cleanup, ignore errors

  res.json({ success: true });
});

module.exports = router;
