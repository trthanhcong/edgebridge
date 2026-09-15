'use strict';

/**
 * Standalone health-check probe used by Docker's HEALTHCHECK.
 * Exits 0 if the gateway health endpoint responds 200, else exits 1.
 */

const http = require('http');

const port = Number.parseInt(process.env.HEALTH_PORT || '8080', 10);
const host = '127.0.0.1';

const req = http.get({ host, port, path: '/health', timeout: 4000 }, (res) => {
  if (res.statusCode === 200) {
    res.resume();
    process.exit(0);
  } else {
    process.exit(1);
  }
});

req.on('error', () => process.exit(1));
req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});
