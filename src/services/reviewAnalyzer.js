'use strict';

/**
 * Heuristic AI "review authenticity" analyzer.
 *
 * Produces a 0–100 authenticity score plus a list of human-readable flags.
 * It is intentionally deterministic and dependency-free so it runs anywhere;
 * a production deployment could swap this for a real LLM call without changing
 * the API contract.
 */

// Generic marketing phrases that correlate with templated / bot-written reviews.
const GENERIC_PHRASES = [
  'best ever', 'highly recommend', 'would recommend', 'must buy', 'life changing',
  'game changer', 'amazing product', 'great product', 'perfect product',
  '100% recommend', 'five stars', '5 stars', 'totally worth', 'worth every',
  'couldn\'t be happier', 'exceeded my expectations', 'beyond my expectations',
  'blown away', 'second to none', 'best in the market', 'best on the market',
];

// Signs of an over-the-top or suspicious review.
const HYPERBOLE = [
  'best', 'perfect', 'amazing', 'incredible', 'awesome', 'outstanding',
  'phenomenal', 'unbelievable', 'fantastic', 'wonderful', 'greatest', 'ever',
];

function countWords(text) {
  return (text.match(/[A-Za-z0-9']+/g) || []).length;
}

function countMatches(text, list) {
  const lower = text.toLowerCase();
  return list.reduce((n, phrase) => n + (lower.includes(phrase) ? 1 : 0), 0);
}

function wordFrequencies(text) {
  const words = (text.toLowerCase().match(/[a-z']+/g) || [])
    .filter((w) => w.length > 3);
  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  return { words: words.length, freq };
}

/**
 * @param {string} text review body
 * @param {number} [rating] 1–5 star rating
 * @returns {{ score:number, authenticity:string, flags:string[], signals:object }}
 */
function analyzeReview(text, rating = 5) {
  const clean = String(text || '').trim();
  const flags = [];
  const signals = {};
  let score = 50; // neutral start

  // --- Length ---
  const words = countWords(clean);
  signals.wordCount = words;
  if (words === 0) {
    return { score: 0, authenticity: 'suspicious', flags: ['Review is empty'], signals };
  }
  if (words < 8) {
    score -= 20;
    flags.push('Very short — limited substance');
  } else if (words >= 60) {
    score += 10;
  } else if (words >= 20) {
    score += 5;
  }

  // --- Exclamation marks ---
  const exclamations = (clean.match(/!/g) || []).length;
  signals.exclamationCount = exclamations;
  const exclRatio = exclamations / Math.max(words, 1);
  if (exclRatio > 0.15) {
    score -= 25;
    flags.push('Excessive exclamation marks');
  } else if (exclRatio > 0.07) {
    score -= 10;
    flags.push('Overuse of exclamation marks');
  }

  // --- ALL CAPS ratio ---
  const capsWords = (clean.match(/\b[A-Z]{2,}\b/g) || []).length;
  signals.capsCount = capsWords;
  if (capsWords / Math.max(words, 1) > 0.3) {
    score -= 20;
    flags.push('Heavy use of ALL CAPS');
  }

  // --- Generic marketing phrases ---
  const generic = countMatches(clean, GENERIC_PHRASES);
  signals.genericPhraseCount = generic;
  if (generic >= 3) {
    score -= 25;
    flags.push('Repetitive templated praise');
  } else if (generic >= 1) {
    score -= 8;
    flags.push('Generic marketing language detected');
  }

  // --- Hyperbole density ---
  const hyperbole = countMatches(clean, HYPERBOLE);
  signals.hyperboleCount = hyperbole;
  if (hyperbole >= 5) {
    score -= 15;
    flags.push('Unusually high superlative density');
  }

  // --- Word repetition ---
  const { words: totalWords, freq } = wordFrequencies(clean);
  const maxFreq = totalWords ? Math.max(...Object.values(freq)) : 0;
  signals.maxWordRepeat = maxFreq;
  if (maxFreq / Math.max(totalWords, 1) > 0.15 && totalWords > 10) {
    score -= 15;
    flags.push('Unnatural word repetition');
  }

  // --- Specific detail (numbers, proper nouns add credibility) ---
  const hasNumber = /\d/.test(clean);
  const hasProperNoun = /[A-Z][a-z]{2,}/.test(clean.replace(/\b[A-Z]+\b/g, ''));
  signals.hasSpecificDetail = hasNumber || hasProperNoun;
  if (hasNumber || hasProperNoun) score += 10;

  // --- Balanced sentiment (pure praise with no downside is less credible) ---
  const negativeTerms = /\b(bad|poor|terrible|awful|issue|problem|disappoint|fail|broken|slow|worst|fault|defect)\b/i;
  const hasCriticism = negativeTerms.test(clean);
  signals.hasCriticism = hasCriticism;
  if (hasCriticism) score += 8;

  // --- Rating consistency ---
  if (rating !== undefined && rating !== null) {
    const r = Number(rating);
    if (r >= 1 && r <= 5) {
      const isGlowing = /\b(best|perfect|amazing|excellent|outstanding|love)\b/i.test(clean);
      if (r <= 2 && isGlowing) {
        score -= 10;
        flags.push('Positive text contradicts a low rating');
      }
    }
  }

  // --- Emoji usage ---
  const emoji = (clean.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
  signals.emojiCount = emoji;
  if (emoji > 8) {
    score -= 10;
    flags.push('Emoji spam');
  }

  // Clamp to 0–100.
  score = Math.max(0, Math.min(100, Math.round(score)));

  let authenticity;
  if (score >= 75) authenticity = 'genuine';
  else if (score >= 45) authenticity = 'likely genuine';
  else if (score >= 25) authenticity = 'suspicious';
  else authenticity = 'likely fake';

  return { score, authenticity, flags, signals };
}

module.exports = { analyzeReview };
