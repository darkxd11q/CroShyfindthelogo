// server.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');

if (!process.env.ADMIN_PASSWORD) {
  console.error('Missing ADMIN_PASSWORD in .env - copy .env.example to .env and set it.');
  process.exit(1);
}
if (!process.env.SESSION_SECRET) {
  console.error('Missing SESSION_SECRET in .env - copy .env.example to .env and set it.');
  process.exit(1);
}

const gameRoutes = require('./routes/game');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"]
    }
  }
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  name: 'logohunt.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production', // set true when served over HTTPS
    maxAge: 1000 * 60 * 60 * 4 // 4 hours
  }
}));

// Uploaded puzzle images (publicly viewable - that's the point of the game)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API routes
app.use('/api/game', gameRoutes);
app.use('/api/admin', adminRoutes);

// Frontend (static HTML/CSS/JS, no build step)
app.use(express.static(path.join(__dirname, 'public')));

// Centralized error handler (e.g. multer errors, unexpected exceptions)
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

app.listen(PORT, () => {
  console.log(`Find the Hidden Logo running at http://localhost:${PORT}`);
  console.log(`Admin panel at http://localhost:${PORT}/admin.html`);
});
