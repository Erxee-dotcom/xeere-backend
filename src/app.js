'use strict';

const express = require('express');
const cors = require('cors');
const config = require('./config');
const { optionalAuth } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');
const usersRoutes = require('./routes/users.routes');
const postsRoutes = require('./routes/posts.routes');
const friendsRoutes = require('./routes/friends.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const messagesRoutes = require('./routes/messages.routes');
const gigsRoutes = require('./routes/gigs.routes');
const reviewsRoutes = require('./routes/reviews.routes');
const aiRoutes = require('./routes/ai.routes');

const app = express();

app.disable('x-powered-by');
app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',') }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// Attach req.user when a valid token is present (feed/likes need optional auth).
app.use(optionalAuth);

// Health check.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'xeere-backend', time: Date.now() });
});

// API routes.
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/gigs', gigsRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/ai', aiRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
