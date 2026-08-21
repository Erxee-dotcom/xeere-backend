'use strict';

/**
 * Seed script — creates a couple of demo users, posts, a gig and a review so
 * the API can be explored without manual setup.
 *
 * Run with: npm run seed
 */

const bcrypt = require('bcryptjs');
const db = require('./db');
const { uuid, now } = require('./utils/helpers');
const { analyzeReview } = require('./services/reviewAnalyzer');

async function seed() {
  const passwordHash = await bcrypt.hash('password123', 10);
  const ts = now();

  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (id, email, password_hash, display_name, username, bio, provider, created_at)
    VALUES (@id, @email, @password_hash, @display_name, @username, @bio, 'email', @created_at)
  `);
  const insertPost = db.prepare(`
    INSERT INTO posts (id, author_id, content, media_url, media_type, created_at, updated_at)
    VALUES (@id, @author_id, @content, @media_url, @media_type, @created_at, @updated_at)
  `);

  const demo = { id: 'seed-user-demo', email: 'demo@xeere.app', password_hash: passwordHash };
  const jane = { id: 'seed-user-jane', email: 'jane@xeere.app', password_hash: passwordHash };

  insertUser.run({
    ...demo,
    display_name: 'Demo User',
    username: 'demo',
    bio: 'Exploring XeeRe',
    created_at: ts,
  });
  insertUser.run({
    ...jane,
    display_name: 'Jane Doe',
    username: 'janedoe',
    bio: 'Loves writing honest reviews',
    created_at: ts - 1000,
  });

  insertPost.run({
    id: 'seed-post-1',
    author_id: demo.id,
    content: 'Just joined XeeRe! Excited to see what the review intelligence can do.',
    media_url: null,
    media_type: null,
    created_at: ts - 5000,
    updated_at: ts - 5000,
  });
  insertPost.run({
    id: 'seed-post-2',
    author_id: jane.id,
    content: 'The AI review analyzer flagged a fake review on my last purchase. Super handy!',
    media_url: null,
    media_type: null,
    created_at: ts - 4000,
    updated_at: ts - 4000,
  });

  // Demo gig.
  db.prepare(`
    INSERT OR IGNORE INTO gigs (id, seller_id, title, description, price, category, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run('seed-gig-1', jane.id, 'Website audit + review analysis',
    'I will audit your product reviews and report suspicious patterns.', 49,
    'writing', ts, ts);

  // Demo review.
  const reviewText = 'This product is absolutely amazing!! Best thing ever!! 100% recommend to everyone, it will change your life!!! BEST BUY EVER!!!';
  const analysis = analyzeReview(reviewText, 5);
  db.prepare(`
    INSERT OR IGNORE INTO reviews (id, author_id, subject, platform, rating, review_text, ai_score, authenticity, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('seed-review-1', demo.id, 'Acme Widget 3000', 'marketplace',
    5, reviewText, analysis.score, analysis.authenticity, ts);

  console.log('Seed complete.');
  console.log('  demo@xeere.app / password123');
  console.log('  jane@xeere.app / password123');
  console.log(`  Sample review authenticity score: ${analysis.score}/100 (${analysis.authenticity})`);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
