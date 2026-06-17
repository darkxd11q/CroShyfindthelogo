// db.js
// Sets up the SQLite database (file-based, no separate DB server needed)
// and creates the schema if it doesn't exist yet.

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite'); // built-in since Node 22.5 - no native build step

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'app.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS images (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    filename      TEXT NOT NULL,
    original_name TEXT,
    width         INTEGER NOT NULL,
    height        INTEGER NOT NULL,
    logo_x        REAL,              -- never exposed to the public API
    logo_y        REAL,              -- never exposed to the public API
    tolerance     REAL NOT NULL DEFAULT 30,
    is_active     INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS votes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    image_id    INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    client_id   TEXT NOT NULL,
    vote_type   TEXT NOT NULL CHECK(vote_type IN ('like','dislike')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(image_id, client_id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    image_id    INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    comment     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_votes_image ON votes(image_id);
  CREATE INDEX IF NOT EXISTS idx_comments_image ON comments(image_id);
`);

module.exports = db;
