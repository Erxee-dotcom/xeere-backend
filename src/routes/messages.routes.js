'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { uuid, now, asyncHandler, toPublicUser, httpError } = require('../utils/helpers');

const router = express.Router();

function serializeMessage(row) {
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    text: row.text,
    read: !!row.read,
    createdAt: row.created_at,
  };
}

/** GET /api/messages/conversations — list conversations with last message. */
router.get('/conversations', requireAuth, asyncHandler(async (req, res) => {
  const rows = db.prepare(`
    SELECT u.*, m.text AS last_text, m.created_at AS last_at, m.sender_id AS last_sender,
      (SELECT COUNT(*) FROM messages mm
        WHERE mm.sender_id = u.id AND mm.recipient_id = ? AND mm.read = 0) AS unread
    FROM users u
    JOIN (
      SELECT CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END AS other_id,
             MAX(created_at) AS latest
      FROM messages
      WHERE sender_id = ? OR recipient_id = ?
      GROUP BY other_id
    ) conv ON conv.other_id = u.id
    JOIN messages m ON m.created_at = conv.latest
      AND ((m.sender_id = ? AND m.recipient_id = u.id) OR (m.recipient_id = ? AND m.sender_id = u.id))
    ORDER BY conv.latest DESC
  `).all(req.userId, req.userId, req.userId, req.userId, req.userId, req.userId);

  res.json({
    conversations: rows.map((r) => ({
      user: toPublicUser(r),
      lastMessage: { text: r.last_text, fromMe: r.last_sender === req.userId, at: r.last_at },
      unread: r.unread,
    })),
  });
}));

/** GET /api/messages/:userId — message thread with a user (paginated). */
router.get('/:userId', requireAuth, asyncHandler(async (req, res) => {
  const other = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
  if (!other) throw httpError(404, 'User not found');

  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
  const before = parseInt(req.query.before, 10) || null;

  const rows = before
    ? db.prepare(`
        SELECT * FROM messages
        WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))
          AND created_at < ?
        ORDER BY created_at DESC LIMIT ?
      `).all(req.userId, other.id, other.id, req.userId, before, limit)
    : db.prepare(`
        SELECT * FROM messages
        WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
        ORDER BY created_at DESC LIMIT ?
      `).all(req.userId, other.id, other.id, req.userId, limit);

  res.json({ messages: rows.reverse().map(serializeMessage) });
}));

/** POST /api/messages/:userId — send a message. */
router.post('/:userId', requireAuth, asyncHandler(async (req, res) => {
  const other = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
  if (!other) throw httpError(404, 'User not found');

  const text = String((req.body || {}).text || '').trim();
  if (!text) throw httpError(400, 'Message text is required');

  const id = uuid();
  const ts = now();
  db.prepare(`
    INSERT INTO messages (id, sender_id, recipient_id, text, read, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(id, req.userId, other.id, text, ts);

  res.status(201).json({ message: serializeMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(id)) });
}));

/** POST /api/messages/:userId/read — mark messages from a user as read. */
router.post('/:userId/read', requireAuth, asyncHandler(async (req, res) => {
  db.prepare(`
    UPDATE messages SET read = 1
    WHERE sender_id = ? AND recipient_id = ? AND read = 0
  `).run(req.params.userId, req.userId);

  res.json({ success: true });
}));

module.exports = router;
