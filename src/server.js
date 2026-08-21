'use strict';

const app = require('./app');
const config = require('./config');
// Ensure the database + schema exist before serving.
require('./db');

const server = app.listen(config.port, config.host, () => {
  // eslint-disable-next-line no-console
  console.log(`XeeRe backend listening on http://${config.host}:${config.port}`);
  console.log(`Environment: ${config.env}`);
});

// Graceful shutdown.
function shutdown() {
  // eslint-disable-next-line no-console
  console.log('Shutting down...');
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
