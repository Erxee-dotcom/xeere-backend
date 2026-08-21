'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { uuid, now, asyncHandler, httpError } = require('../utils/helpers');
const { analyzeReview } = require('../services/reviewAnalyzer');

const router = express.Router();

function serializeReview(row) {
  return {
    id: row.id,
    authorId: row.author_id,
    subject: row.subject,
    platform: row.platform,
    rating: row.rating,
    reviewText: row.review_text,
    aiScore: row.ai_score,
    authenticity: row.authenticity,
    createdAt: row.created_at,
  };
}

/** GET /api/reviews — list reviews (optionally filtered by author or subject). */
router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const authorId = req.query.authorId || null;
  const subject = req.query.subject || null;

  let rows;
  if (authorId) {
    rows = db.prepare('SELECT * FROM reviews WHERE author_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(authorId, limit);
  } else if (subject) {
    rows = db.prepare('SELECT * FROM reviews WHERE subject LIKE ? ORDER BY created_at DESC LIMIT ?')
      .all(`%${subject}%`, limit);
  } else {
    rows = db.prepare('SELECT * FROM reviews ORDER BY created_at DESC LIMIT ?').all(limit);
  }

  res.json({ reviews: rows.map(serializeReview) });
}));

/** GET /api/reviews/:id — single review. */
router.get('/:id', asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
  if (!row) throw httpError(404, 'Review not found');
  res.json({ review: serializeReview(row) });
}));

/** POST /api/reviews — create a review (auto-runs the authenticity analyzer). */
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { subject, platform, rating, reviewText } = req.body || {};

  if (!subject || !String(subject).trim()) throw httpError(400, 'Subject is required');
  if (!reviewText || !String(reviewText).trim()) throw httpError(400, 'reviewText is required');

  const parsedRating = Math.min(5, Math.max(1, parseInt(rating, 10) || 5));
  const analysis = analyzeReview(reviewText, parsedRating);

  const id = uuid();
  const ts = now();
  db.prepare(`
    INSERT INTO reviews (id, author_id, subject, platform, rating, review_text, ai_score, authenticity, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.userId, String(subject).trim(), String(platform || 'other').trim(),
    parsedRating, String(reviewText).trim(), analysis.score, analysis.authenticity, ts);

  const row = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
  res.status(201).json({ review: serializeReview(row), analysis });
}));

/** DELETE /api/reviews/:id — delete own review. */
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
  if (!review) throw httpError(404, 'Review not found');
  if (review.author_id !== req.userId) throw httpError(403, 'Not your review');

  db.prepare('DELETE FROM reviews WHERE id = ?').run(review.id);
  res.json({ success: true });
}));

module.exports = router;
