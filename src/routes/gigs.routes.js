'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { uuid, now, asyncHandler, httpError } = require('../utils/helpers');

const router = express.Router();

function serializeGig(row) {
  return {
    id: row.id,
    seller: { id: row.seller_id, displayName: row.display_name, username: row.username, photoUrl: row.photo_url },
    title: row.title,
    description: row.description,
    price: row.price,
    category: row.category,
    status: row.status,
    createdAt: row.created_at,
  };
}

function serializeOrder(row) {
  return {
    id: row.id,
    gigId: row.gig_id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    amount: row.amount,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ----------------------------- Gigs / Marketplace ----------------------------- */

/** GET /api/gigs — browse marketplace listings. */
router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const category = req.query.category || null;

  const rows = category
    ? db.prepare(`
        SELECT g.*, u.display_name, u.username, u.photo_url
        FROM gigs g JOIN users u ON u.id = g.seller_id
        WHERE g.status = 'active' AND g.category = ?
        ORDER BY g.created_at DESC LIMIT ?
      `).all(category, limit)
    : db.prepare(`
        SELECT g.*, u.display_name, u.username, u.photo_url
        FROM gigs g JOIN users u ON u.id = g.seller_id
        WHERE g.status = 'active'
        ORDER BY g.created_at DESC LIMIT ?
      `).all(limit);

  res.json({ gigs: rows.map(serializeGig) });
}));

/** POST /api/gigs — create a listing. */
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { title, description, price, category } = req.body || {};
  if (!title || !title.trim()) throw httpError(400, 'Title is required');
  const amount = Number(price);
  if (Number.isNaN(amount) || amount < 0) throw httpError(400, 'A valid price is required');

  const id = uuid();
  const ts = now();
  db.prepare(`
    INSERT INTO gigs (id, seller_id, title, description, price, category, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(id, req.userId, String(title).trim(), String(description || '').trim(),
    amount, String(category || 'other').trim(), ts, ts);

  const row = db.prepare(`
    SELECT g.*, u.display_name, u.username, u.photo_url
    FROM gigs g JOIN users u ON u.id = g.seller_id WHERE g.id = ?
  `).get(id);
  res.status(201).json({ gig: serializeGig(row) });
}));

/* ----------------------------- Orders / Escrow ----------------------------- */

/** GET /api/gigs/orders/mine — orders where I am buyer or seller. */
router.get('/orders/mine', requireAuth, asyncHandler(async (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM orders WHERE buyer_id = ? OR seller_id = ?
    ORDER BY created_at DESC
  `).all(req.userId, req.userId);
  res.json({ orders: rows.map(serializeOrder) });
}));

/** POST /api/gigs/orders/:id/status — move an escrow order through its lifecycle. */
router.post('/orders/:id/status', requireAuth, asyncHandler(async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) throw httpError(404, 'Order not found');

  const { status } = req.body || {};
  const valid = ['in_progress', 'delivered', 'completed', 'disputed', 'refunded', 'cancelled'];
  if (!valid.includes(status)) throw httpError(400, `Invalid status (one of ${valid.join(', ')})`);

  const isSeller = order.seller_id === req.userId;
  const isBuyer = order.buyer_id === req.userId;
  if (!isSeller && !isBuyer) throw httpError(403, 'Not a party to this order');

  if (['in_progress', 'delivered'].includes(status) && !isSeller) {
    throw httpError(403, 'Only the seller can perform this action');
  }
  if (['completed', 'disputed', 'cancelled'].includes(status) && !isBuyer) {
    throw httpError(403, 'Only the buyer can perform this action');
  }

  db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, now(), order.id);

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  res.json({ order: serializeOrder(updated) });
}));

/* ----------------------------- Earnings / Payouts ----------------------------- */

/** GET /api/gigs/earnings — seller earnings summary (from completed orders). */
router.get('/earnings', requireAuth, asyncHandler(async (req, res) => {
  const completed = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total FROM orders
    WHERE seller_id = ? AND status = 'completed'
  `).get(req.userId);

  const escrow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total FROM orders
    WHERE seller_id = ? AND status IN ('escrow', 'in_progress', 'delivered')
  `).get(req.userId);

  const paid = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total FROM payouts
    WHERE user_id = ? AND status = 'paid'
  `).get(req.userId);

  const feeRate = 0.10; // platform fee on completed orders
  const gross = completed.total;
  const fee = gross * feeRate;

  res.json({
    earnings: {
      gross,
      platformFee: fee,
      net: gross - fee,
      available: Math.max(gross - fee - paid.total, 0),
      inEscrow: escrow.total,
      paidOut: paid.total,
    },
  });
}));

/** POST /api/gigs/earnings/payout — request a payout of available earnings. */
router.post('/earnings/payout', requireAuth, asyncHandler(async (req, res) => {
  const completed = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total FROM orders
    WHERE seller_id = ? AND status = 'completed'
  `).get(req.userId);
  const paid = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total FROM payouts
    WHERE user_id = ? AND status = 'paid'
  `).get(req.userId);

  const feeRate = 0.10;
  const available = completed.total * (1 - feeRate) - paid.total;

  if (available <= 0) throw httpError(400, 'No earnings available for payout');

  const amount = Number((req.body || {}).amount) || available;
  if (amount <= 0 || amount > available) throw httpError(400, 'Invalid payout amount');

  const id = uuid();
  const ts = now();
  db.prepare(`
    INSERT INTO payouts (id, user_id, amount, method, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'paid', ?, ?)
  `).run(id, req.userId, amount, String((req.body || {}).method || 'bank'), ts, ts);

  res.status(201).json({
    payout: { id, amount, status: 'paid', createdAt: ts },
    availableAfter: Math.round((available - amount) * 100) / 100,
  });
}));

/* ----------------------------- Single gig + ordering ----------------------------- */

/** GET /api/gigs/:id — single listing. */
router.get('/:id', asyncHandler(async (req, res) => {
  const row = db.prepare(`
    SELECT g.*, u.display_name, u.username, u.photo_url
    FROM gigs g JOIN users u ON u.id = g.seller_id WHERE g.id = ?
  `).get(req.params.id);
  if (!row) throw httpError(404, 'Gig not found');
  res.json({ gig: serializeGig(row) });
}));

/** POST /api/gigs/:id/order — place an order (funds go into escrow). */
router.post('/:id/order', requireAuth, asyncHandler(async (req, res) => {
  const gig = db.prepare('SELECT * FROM gigs WHERE id = ? AND status = ?')
    .get(req.params.id, 'active');
  if (!gig) throw httpError(404, 'Gig not found or not available');
  if (gig.seller_id === req.userId) throw httpError(400, 'You cannot order your own gig');

  const id = uuid();
  const ts = now();
  db.prepare(`
    INSERT INTO orders (id, gig_id, buyer_id, seller_id, amount, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'escrow', ?, ?)
  `).run(id, gig.id, req.userId, gig.seller_id, gig.price, ts, ts);

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  res.status(201).json({ order: serializeOrder(order) });
}));

/** PUT /api/gigs/:id — update own listing. */
router.put('/:id', requireAuth, asyncHandler(async (req, res) => {
  const gig = db.prepare('SELECT * FROM gigs WHERE id = ?').get(req.params.id);
  if (!gig) throw httpError(404, 'Gig not found');
  if (gig.seller_id !== req.userId) throw httpError(403, 'Not your listing');

  const { title, description, price, category, status } = req.body || {};
  const nextTitle = title !== undefined ? String(title).trim() : gig.title;
  const nextDesc = description !== undefined ? String(description).trim() : gig.description;
  const nextPrice = price !== undefined ? Number(price) : gig.price;
  const nextCategory = category !== undefined ? String(category).trim() : gig.category;
  const nextStatus = status !== undefined ? status : gig.status;

  if (!nextTitle) throw httpError(400, 'Title cannot be empty');
  if (Number.isNaN(nextPrice) || nextPrice < 0) throw httpError(400, 'Invalid price');
  if (!['active', 'inactive', 'sold'].includes(nextStatus)) throw httpError(400, 'Invalid status');

  db.prepare(`
    UPDATE gigs SET title = ?, description = ?, price = ?, category = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(nextTitle, nextDesc, nextPrice, nextCategory, nextStatus, now(), gig.id);

  const row = db.prepare(`
    SELECT g.*, u.display_name, u.username, u.photo_url
    FROM gigs g JOIN users u ON u.id = g.seller_id WHERE g.id = ?
  `).get(gig.id);
  res.json({ gig: serializeGig(row) });
}));

/** DELETE /api/gigs/:id — remove own listing. */
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const gig = db.prepare('SELECT * FROM gigs WHERE id = ?').get(req.params.id);
  if (!gig) throw httpError(404, 'Gig not found');
  if (gig.seller_id !== req.userId) throw httpError(403, 'Not your listing');

  db.prepare('DELETE FROM gigs WHERE id = ?').run(gig.id);
  res.json({ success: true });
}));

module.exports = router;
