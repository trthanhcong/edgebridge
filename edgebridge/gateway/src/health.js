'use strict';

const http = require('http');

/**
 * Lightweight health-check HTTP server.
 *
 * Exposes:
 *   GET /health   -> 200 {"status":"ok",...}
 *   GET /          -> 200 (same as /health)
 * Any other path -> 404. No authentication is required on the health endpoint,
 * and it never exposes credentials or configuration secrets.
 */
function startHealthServer(config, logger, getStats) {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/' || req.url === '/healthz')) {
      const body = JSON.stringify({
        status: 'ok',
        service: 'edgebridge-gateway',
        authMode: config.authMode,
        proxyPort: config.port,
        uptimeSec: Math.floor(process.uptime()),
        ...(getStats ? getStats() : {}),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'not_found' }));
  });

  server.listen(config.healthPort, config.bindHost, () => {
    logger.info('health server listening', {
      host: config.bindHost,
      port: config.healthPort,
    });
  });

  server.on('error', (err) => {
    logger.error('health server error', { error: err.message });
  });

  return server;
}

module.exports = { startHealthServer };
