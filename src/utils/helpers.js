'use strict';

const crypto = require('crypto');

/** Generate a UUID v4 string. */
function uuid() {
  return crypto.randomUUID();
}

/** Return current time in milliseconds (matches JS Date.now()). */
function now() {
  return Date.now();
}

/** Wrap an async route handler so thrown errors reach the error middleware. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Convert an SQLite row (snake_case) into an API object (camelCase). */
function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    username: row.username,
    photoUrl: row.photo_url,
    bio: row.bio,
    provider: row.provider,
    createdAt: row.created_at,
  };
}

/** Sanitize a user for public consumption (never leak email/password). */
function toPublicUser(row) {
  const u = toUser(row);
  if (!u) return null;
  const { email, ...rest } = u;
  return rest;
}

function toPost(row) {
  if (!row) return null;
  return {
    id: row.id,
    authorId: row.author_id,
    content: row.content,
    mediaUrl: row.media_url,
    mediaType: row.media_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Small helper to build error objects with a status code.
 * usage: throw httpError(404, 'Not found')
 */
function httpError(status, message, extra) {
  const err = new Error(message);
  err.status = status;
  if (extra) Object.assign(err, extra);
  return err;
}

module.exports = {
  uuid,
  now,
  asyncHandler,
  toUser,
  toPublicUser,
  toPost,
  httpError,
};
