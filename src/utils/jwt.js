'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

/** Sign a JWT for a given user. */
function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

/** Verify a JWT and return the payload, or null if invalid. */
function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

module.exports = { signToken, verifyToken };
