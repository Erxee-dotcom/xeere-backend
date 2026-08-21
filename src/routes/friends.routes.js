'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { uuid, now, asyncHandler, toPublicUser, httpError } = require('../utils/helpers');

const router = express.Router();

function friendshipBetween(a, b) {
  return db.prepare(`
    SELECT * FROM friendships
    WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)
  `).get(a, b, b, a);
}

/** POST /api/friends/request — send a friend request. */
router.post('/request', requireAuth, asyncHandler(async (req, res) => {
  const { userId } = req.body || {};
  if (!userId) throw httpError(400, 'userId is required');
  if (userId === req.userId) throw httpError(400, 'You cannot friend yourself');

  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!target) throw httpError(404, 'User not found');

  const existing = friendshipBetween(req.userId, userId);
  if (existing) {
    throw httpError(409, existing.status === 'blocked'
      ? 'You cannot friend this user'
      : 'A friend request already exists');
  }

  const id = uuid();
  const ts = now();
  db.prepare(`
    INSERT INTO friendships (id, requester_id, addressee_id, status, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?)
  `).run(id, req.userId, userId, ts, ts);

  res.status(201).json({ friendship: getFriendshipRow(id) });
}));

/** POST /api/friends/respond — accept or decline a pending request. */
router.post('/respond', requireAuth, asyncHandler(async (req, res) => {
  const { friendshipId, action } = req.body || {};
  if (!friendshipId || !['accept', 'decline'].includes(action)) {
    throw httpError(400, 'friendshipId and action ("accept"|"decline") are required');
  }

  const friendship = db.prepare('SELECT * FROM friendships WHERE id = ?').get(friendshipId);
  if (!friendship) throw httpError(404, 'Friend request not found');
  if (friendship.addressee_id !== req.userId) throw httpError(403, 'This request is not for you');
  if (friendship.status !== 'pending') throw httpError(409, 'Request already handled');

  const status = action === 'accept' ? 'accepted' : 'declined';
  db.prepare('UPDATE friendships SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, now(), friendshipId);

  res.json({ friendship: getFriendshipRow(friendshipId) });
}));

/** DELETE /api/friends/:userId — remove a friend or cancel a request. */
router.delete('/:userId', requireAuth, asyncHandler(async (req, res) => {
  const existing = friendshipBetween(req.userId, req.params.userId);
  if (!existing) throw httpError(404, 'No friendship or request with this user');

  db.prepare('DELETE FROM friendships WHERE id = ?').run(existing.id);
  res.json({ success: true });
}));

/** GET /api/friends — list accepted friends. */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const rows = db.prepare(`
    SELECT u.* FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
    WHERE (f.requester_id = ? OR f.addressee_id = ?) AND f.status = 'accepted'
    ORDER BY u.display_name ASC
  `).all(req.userId, req.userId, req.userId);

  res.json({ friends: rows.map(toPublicUser) });
}));

/** GET /api/friends/requests — incoming pending requests. */
router.get('/requests', requireAuth, asyncHandler(async (req, res) => {
  const rows = db.prepare(`
    SELECT f.*, u.display_name, u.username, u.photo_url
    FROM friendships f JOIN users u ON u.id = f.requester_id
    WHERE f.addressee_id = ? AND f.status = 'pending'
    ORDER BY f.created_at DESC
  `).all(req.userId);

  res.json({
    requests: rows.map((r) => ({
      id: r.id,
      from: { id: r.requester_id, displayName: r.display_name, username: r.username, photoUrl: r.photo_url },
      createdAt: r.created_at,
    })),
  });
}));

/** GET /api/friends/suggestions — "people you may know". */
router.get('/suggestions', requireAuth, asyncHandler(async (req, res) => {
  // Simple heuristic: users you are not yet connected to, excluding yourself.
  const rows = db.prepare(`
    SELECT u.* FROM users u
    WHERE u.id != ?
      AND u.id NOT IN (
        SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END
        FROM friendships WHERE requester_id = ? OR addressee_id = ?
      )
    ORDER BY u.created_at DESC LIMIT 20
  `).all(req.userId, req.userId, req.userId, req.userId);

  res.json({ suggestions: rows.map(toPublicUser) });
}));

function getFriendshipRow(id) {
  const r = db.prepare('SELECT * FROM friendships WHERE id = ?').get(id);
  return r && {
    id: r.id,
    requesterId: r.requester_id,
    addresseeId: r.addressee_id,
    status: r.status,
    createdAt: r.created_at,
  };
}

module.exports = router;
