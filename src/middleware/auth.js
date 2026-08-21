'use strict';

const db = require('../db');
const { verifyToken } = require('../utils/jwt');
const { httpError } = require('../utils/helpers');

/**
 * Require a valid Bearer token. Attaches the full user row to req.user.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return next(httpError(401, 'Authentication required'));
  }

  const payload = verifyToken(token);
  if (!payload) {
    return next(httpError(401, 'Invalid or expired token'));
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
  if (!user) {
    return next(httpError(401, 'User no longer exists'));
  }

  req.user = user;
  req.userId = user.id;
  return next();
}

/**
 * Optional auth — attaches req.user when a valid token is present,
 * otherwise continues anonymously.
 */
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
      if (user) {
        req.user = user;
        req.userId = user.id;
      }
    }
  }
  return next();
}

module.exports = { requireAuth, optionalAuth };
