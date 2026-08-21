'use strict';

const express = require('express');
const { analyzeReview } = require('../services/reviewAnalyzer');
const { asyncHandler, httpError } = require('../utils/helpers');

const router = express.Router();

/**
 * POST /api/ai/analyze-review
 * Body: { text: string, rating?: number }
 * Returns a 0–100 authenticity score, a verdict, flags and signals.
 *
 * This is the "AI Review Authenticity Analyzer" feature exposed without auth
 * so it can power the in-app analyzer tool directly.
 */
router.post('/analyze-review', asyncHandler(async (req, res) => {
  const { text, rating } = req.body || {};
  if (!text || !String(text).trim()) throw httpError(400, 'text is required');

  const result = analyzeReview(text, rating);
  res.json({
    input: String(text).trim(),
    ...result,
  });
}));

/** Simple health/status check for the AI service. */
router.get('/status', (req, res) => {
  res.json({ status: 'ok', engine: 'heuristic-review-analyzer-v1' });
});

module.exports = router;
