'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken } = require('../utils/jwt');
const { requireAuth } = require('../middleware/auth');
const { uuid, now, asyncHandler, toUser, httpError } = require('../utils/helpers');

const router = express.Router();

/** POST /api/auth/register — create a new account. */
router.post('/register', asyncHandler(async (req, res) => {
  const { email, password, displayName, username } = req.body || {};

  if (!email || !password) {
    throw httpError(400, 'Email and password are required');
  }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw httpError(400, 'A valid email is required');
  }
  if (password.length < 6) {
    throw httpError(400, 'Password must be at least 6 characters');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    throw httpError(409, 'An account with this email already exists');
  }

  const desiredUsername = (username || '').trim() || normalizedEmail.split('@')[0];
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(desiredUsername)) {
    throw httpError(409, 'That username is already taken');
  }

  const id = uuid();
  const passwordHash = await bcrypt.hash(password, 10);

  db.prepare(`
    INSERT INTO users (id, email, password_hash, display_name, username, provider, created_at)
    VALUES (?, ?, ?, ?, ?, 'email', ?)
  `).run(id, normalizedEmail, passwordHash, displayName || desiredUsername, desiredUsername, now());

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const token = signToken(user);

  res.status(201).json({ token, user: toUser(user) });
}));

/** POST /api/auth/login — sign in with email + password. */
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    throw httpError(400, 'Email and password are required');
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?')
    .get(String(email).trim().toLowerCase());

  if (!user || !user.password_hash) {
    throw httpError(401, 'Invalid email or password');
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    throw httpError(401, 'Invalid email or password');
  }

  const token = signToken(user);
  res.json({ token, user: toUser(user) });
}));

/** GET /api/auth/me — current authenticated user. */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: toUser(req.user) });
});

/** PUT /api/auth/me — update the authenticated user's profile. */
router.put('/me', requireAuth, asyncHandler(async (req, res) => {
  const { displayName, username, bio, photoUrl } = req.body || {};
  const user = req.user;

  const nextDisplayName = displayName !== undefined ? String(displayName).trim() : user.display_name;
  const nextBio = bio !== undefined ? String(bio).trim() : user.bio;
  const nextPhotoUrl = photoUrl !== undefined ? String(photoUrl).trim() : user.photo_url;
  let nextUsername = user.username;

  if (username !== undefined) {
    nextUsername = String(username).trim();
    if (!nextUsername) throw httpError(400, 'Username cannot be empty');
    const taken = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?')
      .get(nextUsername, user.id);
    if (taken) throw httpError(409, 'That username is already taken');
  }

  db.prepare(`
    UPDATE users SET display_name = ?, username = ?, bio = ?, photo_url = ? WHERE id = ?
  `).run(nextDisplayName, nextUsername, nextBio, nextPhotoUrl, user.id);

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.json({ user: toUser(updated) });
}));

/** POST /api/auth/change-password — update password for email accounts. */
router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    throw httpError(400, 'currentPassword and newPassword are required');
  }
  if (newPassword.length < 6) {
    throw httpError(400, 'New password must be at least 6 characters');
  }
  if (!req.user.password_hash) {
    throw httpError(400, 'This account uses a social login and has no password');
  }

  const ok = await bcrypt.compare(currentPassword, req.user.password_hash);
  if (!ok) throw httpError(401, 'Current password is incorrect');

  const hash = await bcrypt.hash(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);

  res.json({ success: true });
}));

module.exports = router;
