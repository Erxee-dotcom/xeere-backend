'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, toPublicUser, httpError } = require('../utils/helpers');

const router = express.Router();

/** GET /api/users/search?q= — search users by name/username/email. */
router.get('/search', requireAuth, asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ users: [] });

  const like = `%${q}%`;
  const rows = db.prepare(`
    SELECT * FROM users
    WHERE display_name LIKE ? OR username LIKE ? OR email LIKE ?
    ORDER BY display_name ASC LIMIT 50
  `).all(like, like, like);

  res.json({ users: rows.map(toPublicUser) });
}));

/** GET /api/users/:id — public profile for a user. */
router.get('/:id', asyncHandler(async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) throw httpError(404, 'User not found');
  res.json({ user: toPublicUser(user) });
}));

/** GET /api/users/:id/posts — a user's posts (paginated). */
router.get('/:id/posts', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const before = parseInt(req.query.before, 10) || null;

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) throw httpError(404, 'User not found');

  const rows = before
    ? db.prepare(`
        SELECT p.*, u.display_name, u.username, u.photo_url,
          (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
          (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
        FROM posts p JOIN users u ON u.id = p.author_id
        WHERE p.author_id = ? AND p.created_at < ?
        ORDER BY p.created_at DESC LIMIT ?
      `).all(req.params.id, before, limit)
    : db.prepare(`
        SELECT p.*, u.display_name, u.username, u.photo_url,
          (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
          (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
        FROM posts p JOIN users u ON u.id = p.author_id
        WHERE p.author_id = ?
        ORDER BY p.created_at DESC LIMIT ?
      `).all(req.params.id, limit);

  res.json({ posts: rows.map(serializePost) });
}));

function serializePost(row) {
  return {
    id: row.id,
    author: {
      id: row.author_id,
      displayName: row.display_name,
      username: row.username,
      photoUrl: row.photo_url,
    },
    content: row.content,
    mediaUrl: row.media_url,
    mediaType: row.media_type,
    likeCount: row.like_count,
    commentCount: row.comment_count,
    createdAt: row.created_at,
  };
}

module.exports = router;
