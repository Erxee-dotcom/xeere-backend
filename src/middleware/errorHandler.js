'use strict';

/** 404 handler for unknown routes. */
function notFound(req, res) {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
}

/** Central error handler — maps thrown httpError objects to responses. */
function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  const body = {
    error: err.message || 'Internal server error',
  };

  if (status === 500 && process.env.NODE_ENV !== 'production') {
    body.stack = err.stack;
  }

  res.status(status).json(body);
}

module.exports = { notFound, errorHandler };
