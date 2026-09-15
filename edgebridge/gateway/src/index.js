'use strict';

const net = require('net');
const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { handleSocks5 } = require('./socks5');
const { handleHttpConnect } = require('./httpconnect');
const { startHealthServer } = require('./health');

/**
 * EdgeBridge Gateway entry point.
 *
 * A single TCP listener serves BOTH protocols:
 *   - SOCKS5 clients send 0x05 as the first byte.
 *   - HTTP CONNECT clients send an ASCII method (e.g. "C" of "CONNECT").
 * We peek the first byte to route each connection to the correct handler.
 */

function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    // Fail fast with a clear message; never start an insecure/open proxy.
    process.stderr.write(`[FATAL] Configuration error: ${err.message}\n`);
    process.exit(1);
    return;
  }

  const logger = createLogger(config.logLevel);

  const stats = { active: 0, total: 0 };

  const server = net.createServer((socket) => {
    stats.active += 1;
    stats.total += 1;
    socket.on('close', () => {
      stats.active -= 1;
    });

    // Basic hardening: don't let idle handshakes hang forever.
    socket.setTimeout(30000, () => {
      logger.debug('socket idle timeout during handshake', {
        client: `${socket.remoteAddress}:${socket.remotePort}`,
      });
      socket.destroy();
    });

    socket.once('data', (chunk) => {
      // Clear the handshake timeout once the tunnel is being set up; the
      // individual handlers manage their own lifecycle afterwards.
      socket.setTimeout(0);

      // Route by the first byte, handing the already-received chunk to the
      // handler (each handler accumulates from here — no unshift needed).
      const firstByte = chunk[0];
      if (firstByte === 0x05) {
        handleSocks5(socket, chunk, config, logger);
      } else {
        // Treat everything else as an HTTP request (CONNECT expected).
        handleHttpConnect(socket, config, logger, chunk);
      }
    });

    socket.on('error', (err) => {
      logger.debug('client socket error', { error: err.message });
    });
  });

  server.on('error', (err) => {
    logger.error('proxy server error', { error: err.message });
    if (err.code === 'EADDRINUSE') process.exit(1);
  });

  server.listen(config.port, config.bindHost, () => {
    logger.info('EdgeBridge gateway listening', {
      host: config.bindHost,
      port: config.port,
      authMode: config.authMode,
      allowlist: config.allowlist,
      allowedPorts: config.allowedPorts.length ? config.allowedPorts : 'all',
    });
  });

  startHealthServer(config, logger, () => ({
    activeConnections: stats.active,
    totalConnections: stats.total,
  }));

  // Graceful shutdown.
  function shutdown(signal) {
    logger.info('shutting down', { signal });
    server.close(() => process.exit(0));
    // Force exit if connections keep it alive too long.
    setTimeout(() => process.exit(0), 5000).unref();
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
