// middleware/auth.js
// Protects admin-only routes. Relies on a server-side session set after
// a successful password check in routes/admin.js - the password itself
// is never stored in the session or sent back to any client.

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin === true) {
    return next();
  }
  return res.status(401).json({ error: 'Not authenticated.' });
}

module.exports = { requireAdmin };
