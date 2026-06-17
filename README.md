# Find the Hidden Logo

A click-the-hidden-logo game with likes/dislikes, a no-login comment section,
and a password-protected admin panel for uploading puzzle photos and placing
the hidden logo's location.

Backend: Node.js + Express
Database: SQLite (via Node's built-in `node:sqlite` module - no native
build step, no separate database server to install)
Frontend: plain HTML/CSS/JS, no build step or framework required

## How the security requirements are met

- **Password storage**: the admin password lives only in `.env`
  (`ADMIN_PASSWORD`), loaded with `dotenv`. It is never hard-coded, never
  logged, and never sent to the browser. Login is checked with a
  constant-time hash comparison (`crypto.timingSafeEqual`) to avoid timing
  attacks, and login attempts are rate-limited.
- **Coordinates never reach the client**: `GET /api/game/active` (the
  endpoint the game page calls) only returns `{ id, url, width, height }`.
  The columns `logo_x`, `logo_y`, and `tolerance` are simply never put into
  that JSON - look at `serializeAdminImage` vs the public route in
  `routes/game.js` to see the difference. They're only ever returned to an
  authenticated admin session, which is the one place that needs them.
- **Server-side click verification**: when a player clicks the photo, the
  browser sends pixel coordinates (scaled to the image's natural
  resolution) to `POST /api/game/:id/guess`. The server loads the real
  `logo_x`/`logo_y` from the database, computes the distance, compares it
  against the stored tolerance radius, and returns only `{ correct: true/false }`.
  There's no way for the client to compute or guess this itself, and
  repeated guesses are rate-limited.
- **Sessions**: the admin panel uses a signed, `httpOnly` session cookie
  (`express-session`, secret from `.env`). Protected routes are gated by
  `middleware/auth.js`.
- **Uploads**: restricted to image MIME types, capped at 8MB, renamed to
  random filenames on disk.
- **Comments**: rendered with `textContent` (not `innerHTML`) on the
  frontend, so user input can't inject HTML/scripts.

## Project layout

```
logo-hunt/
├── server.js              Express app entry point
├── db.js                  SQLite schema + connection
├── middleware/auth.js     requireAdmin session guard
├── routes/game.js         public game API (puzzle, guesses, votes, comments)
├── routes/admin.js        admin API (login, upload, set logo, activate, delete)
├── public/
│   ├── index.html         player view
│   ├── admin.html         admin panel
│   ├── css/                style.css (shared) + admin.css
│   └── js/                 app.js (player) + admin.js (admin)
├── uploads/                uploaded puzzle photos (served statically)
├── data/                   app.db (created automatically on first run)
├── .env                    secrets (ADMIN_PASSWORD, SESSION_SECRET, PORT)
└── .env.example            template for the above
```

## Setup

Requires **Node.js 22.5 or newer** (for the built-in `node:sqlite` module).
Check your version with `node -v`; if you're on an older Node, see the
note at the bottom of this file.

```bash
npm install
```

The `.env` file is already included with the requested admin password
(`croshyezcerez`). For any real deployment, change `SESSION_SECRET` to your
own long random string, and consider changing `ADMIN_PASSWORD` too:

```
ADMIN_PASSWORD=croshyezcerez
SESSION_SECRET=please-change-this-to-a-long-random-string-in-production
PORT=3000
```

Then start the server:

```bash
npm start
```

- Player view: http://localhost:3000
- Admin panel: http://localhost:3000/admin.html

## Using the admin panel

1. Go to `/admin.html` and enter the password.
2. Upload a photo.
3. Click **Set logo** on its card, click the exact spot on the image where
   the logo is hidden, adjust the click-tolerance slider if you want a more
   or less forgiving hit radius, then **Save logo location**.
4. Click **Activate** to make that photo the one players see at `/`. Only
   one image can be active at a time.
5. Likes, dislikes, and comment counts for each image are shown on its
   card; **Delete** removes the image and all of its votes/comments.

## Notes & production considerations

This is built to run as a single Node process with a local SQLite file -
perfect for a small/medium deployment, but a few things to upgrade if you
take it further:
- The session store defaults to in-memory, which is fine for one server
  process but won't survive a restart or scale across multiple instances -
  swap in a store like `connect-sqlite3` or Redis if needed.
- Cookies are sent over plain HTTP in development; set `NODE_ENV=production`
  and serve over HTTPS so the `secure` cookie flag takes effect.
- `node:sqlite` is still labeled experimental by Node.js (it works
  reliably here, but the API could change in a future Node release). If you
  need a long-term-stable database driver instead, swap `db.js` to use
  `better-sqlite3` - the call patterns (`db.prepare(...).get/all/run(...)`)
  are nearly identical, you'd mainly need a working native build toolchain
  for that package's install step.
