'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { uuid, now, asyncHandler, httpError } = require('../utils/helpers');

const router = express.Router();

/**
 * Create a notification for a user. Exported for reuse by other routes.
 */
function notify(userId, type, message, { actorId = null, refId = null } = {}) {
  db.prepare(`
    INSERT INTO notifications (id, user_id, type, actor_id, ref_id, message, read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(uuid(), userId, type, actorId, refId, message, now());
}

/** GET /api/notifications — current user's notifications. */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);

  const rows = db.prepare(`
    SELECT n.*, u.display_name AS actor_name, u.photo_url AS actor_photo
    FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
    WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT ?
  `).all(req.userId, limit);

  res.json({
    notifications: rows.map((r) => ({
      id: r.id,
      type: r.type,
      actor: r.actor_id ? { id: r.actor_id, displayName: r.actor_name, photoUrl: r.actor_photo } : null,
      refId: r.ref_id,
      message: r.message,
      read: !!r.read,
      createdAt: r.created_at,
    })),
  });
}));

/** GET /api/notifications/unread-count — number of unread notifications. */
router.get('/unread-count', requireAuth, (req, res) => {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0')
    .get(req.userId);
  res.json({ count: c });
});

/** POST /api/notifications/:id/read — mark one as read. */
router.post('/:id/read', requireAuth, asyncHandler(async (req, res) => {
  const n = db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId);
  if (!n) throw httpError(404, 'Notification not found');

  db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(n.id);
  res.json({ success: true });
}));

/** POST /api/notifications/read-all — mark all as read. */
router.post('/read-all', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.userId);
  res.json({ success: true });
});

module.exports = router;
module.exports.notify = notify;
