'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { uuid, now, asyncHandler, httpError } = require('../utils/helpers');

const router = express.Router();

const FEED_COLUMNS = `
  p.*, u.display_name, u.username, u.photo_url,
  (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
  (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
`;

function serializePost(row, viewerId) {
  const liked = viewerId
    ? !!db.prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?')
        .get(row.id, viewerId)
    : false;
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
    likedByMe: liked,
    createdAt: row.created_at,
  };
}

/** GET /api/posts — feed, newest first (paginated with `before`). */
router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const before = parseInt(req.query.before, 10) || null;
  const authorId = req.query.authorId || null;
  const viewerId = req.userId || null;

  let rows;
  if (before && authorId) {
    rows = db.prepare(`SELECT ${FEED_COLUMNS} FROM posts p JOIN users u ON u.id = p.author_id
      WHERE p.author_id = ? AND p.created_at < ? ORDER BY p.created_at DESC LIMIT ?`)
      .all(authorId, before, limit);
  } else if (authorId) {
    rows = db.prepare(`SELECT ${FEED_COLUMNS} FROM posts p JOIN users u ON u.id = p.author_id
      WHERE p.author_id = ? ORDER BY p.created_at DESC LIMIT ?`).all(authorId, limit);
  } else if (before) {
    rows = db.prepare(`SELECT ${FEED_COLUMNS} FROM posts p JOIN users u ON u.id = p.author_id
      WHERE p.created_at < ? ORDER BY p.created_at DESC LIMIT ?`).all(before, limit);
  } else {
    rows = db.prepare(`SELECT ${FEED_COLUMNS} FROM posts p JOIN users u ON u.id = p.author_id
      ORDER BY p.created_at DESC LIMIT ?`).all(limit);
  }

  res.json({ posts: rows.map((r) => serializePost(r, viewerId)) });
}));

/** GET /api/posts/:id — single post. */
router.get('/:id', asyncHandler(async (req, res) => {
  const row = db.prepare(`SELECT ${FEED_COLUMNS} FROM posts p JOIN users u ON u.id = p.author_id
    WHERE p.id = ?`).get(req.params.id);
  if (!row) throw httpError(404, 'Post not found');
  res.json({ post: serializePost(row, req.userId) });
}));

/** POST /api/posts — create a post. */
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { content, mediaUrl, mediaType } = req.body || {};
  const text = (content || '').toString().trim();

  if (!text && !mediaUrl) {
    throw httpError(400, 'Post must have content or media');
  }
  if (mediaType && !['image', 'video'].includes(mediaType)) {
    throw httpError(400, 'mediaType must be "image" or "video"');
  }

  const id = uuid();
  const ts = now();
  db.prepare(`
    INSERT INTO posts (id, author_id, content, media_url, media_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.userId, text, mediaUrl || null, mediaType || null, ts, ts);

  const row = db.prepare(`SELECT ${FEED_COLUMNS} FROM posts p JOIN users u ON u.id = p.author_id
    WHERE p.id = ?`).get(id);
  res.status(201).json({ post: serializePost(row, req.userId) });
}));

/** PUT /api/posts/:id — edit own post. */
router.put('/:id', requireAuth, asyncHandler(async (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) throw httpError(404, 'Post not found');
  if (post.author_id !== req.userId) throw httpError(403, 'Not your post');

  const { content, mediaUrl, mediaType } = req.body || {};
  const text = content !== undefined ? String(content).trim() : post.content;
  const nextMediaUrl = mediaUrl !== undefined ? mediaUrl : post.media_url;
  const nextMediaType = mediaType !== undefined ? mediaType : post.media_type;

  if (!text && !nextMediaUrl) throw httpError(400, 'Post must have content or media');
  if (nextMediaType && !['image', 'video'].includes(nextMediaType)) {
    throw httpError(400, 'mediaType must be "image" or "video"');
  }

  db.prepare(`
    UPDATE posts SET content = ?, media_url = ?, media_type = ?, updated_at = ? WHERE id = ?
  `).run(text, nextMediaUrl || null, nextMediaType || null, now(), post.id);

  const row = db.prepare(`SELECT ${FEED_COLUMNS} FROM posts p JOIN users u ON u.id = p.author_id
    WHERE p.id = ?`).get(post.id);
  res.json({ post: serializePost(row, req.userId) });
}));

/** DELETE /api/posts/:id — delete own post. */
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) throw httpError(404, 'Post not found');
  if (post.author_id !== req.userId) throw httpError(403, 'Not your post');

  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  res.json({ success: true });
}));

/** POST /api/posts/:id/like — toggle like. */
router.post('/:id/like', requireAuth, asyncHandler(async (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) throw httpError(404, 'Post not found');

  const existing = db.prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?')
    .get(post.id, req.userId);

  if (existing) {
    db.prepare('DELETE FROM likes WHERE post_id = ? AND user_id = ?').run(post.id, req.userId);
  } else {
    db.prepare('INSERT INTO likes (post_id, user_id, created_at) VALUES (?, ?, ?)')
      .run(post.id, req.userId, now());
  }

  const { like_count } = db.prepare('SELECT COUNT(*) AS like_count FROM likes WHERE post_id = ?')
    .get(post.id);
  res.json({ liked: !existing, likeCount: like_count });
}));

/** GET /api/posts/:id/comments — list comments. */
router.get('/:id/comments', asyncHandler(async (req, res) => {
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) throw httpError(404, 'Post not found');

  const rows = db.prepare(`
    SELECT c.*, u.display_name, u.username, u.photo_url
    FROM comments c JOIN users u ON u.id = c.author_id
    WHERE c.post_id = ? ORDER BY c.created_at ASC
  `).all(post.id);

  res.json({
    comments: rows.map((r) => ({
      id: r.id,
      postId: r.post_id,
      author: { id: r.author_id, displayName: r.display_name, username: r.username, photoUrl: r.photo_url },
      text: r.text,
      createdAt: r.created_at,
    })),
  });
}));

/** POST /api/posts/:id/comments — add a comment. */
router.post('/:id/comments', requireAuth, asyncHandler(async (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) throw httpError(404, 'Post not found');

  const text = String((req.body || {}).text || '').trim();
  if (!text) throw httpError(400, 'Comment text is required');

  const id = uuid();
  const ts = now();
  db.prepare(`
    INSERT INTO comments (id, post_id, author_id, text, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, post.id, req.userId, text, ts);

  res.status(201).json({
    comment: {
      id,
      postId: post.id,
      author: {
        id: req.user.id,
        displayName: req.user.display_name,
        username: req.user.username,
        photoUrl: req.user.photo_url,
      },
      text,
      createdAt: ts,
    },
  });
}));

/** DELETE /api/posts/:id/comments/:commentId — remove a comment. */
router.delete('/:id/comments/:commentId', requireAuth, asyncHandler(async (req, res) => {
  const comment = db.prepare('SELECT * FROM comments WHERE id = ? AND post_id = ?')
    .get(req.params.commentId, req.params.id);
  if (!comment) throw httpError(404, 'Comment not found');
  if (comment.author_id !== req.userId) throw httpError(403, 'Not your comment');

  db.prepare('DELETE FROM comments WHERE id = ?').run(comment.id);
  res.json({ success: true });
}));

module.exports = router;
