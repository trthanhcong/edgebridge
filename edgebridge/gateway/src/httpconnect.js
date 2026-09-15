'use strict';

const net = require('net');
const { verifyCredentials } = require('./auth');
const { isAllowed } = require('./access');

/**
 * HTTP CONNECT proxy handler.
 *
 * Handles the CONNECT method (used by browsers for HTTPS tunneling and, when
 * configured as an HTTP proxy, for arbitrary TCP tunnels). Requires HTTP Basic
 * authentication (Proxy-Authorization header). Plain (non-CONNECT) HTTP proxy
 * requests are rejected to keep the surface small and avoid logging traffic.
 */

function parseProxyAuth(headerValue) {
  // Expects: "Basic base64(user:pass)"
  if (!headerValue) return null;
  const parts = headerValue.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'basic') return null;
  let decoded;
  try {
    decoded = Buffer.from(parts[1], 'base64').toString('utf8');
  } catch (_) {
    return null;
  }
  const idx = decoded.indexOf(':');
  if (idx < 0) return null;
  return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
}

function writeResponse(socket, statusLine, extraHeaders) {
  const headers = [
    `HTTP/1.1 ${statusLine}`,
    'Proxy-Agent: EdgeBridge',
    ...(extraHeaders || []),
    'Connection: close',
    '',
    '',
  ];
  try {
    socket.write(headers.join('\r\n'));
  } catch (_) {
    /* ignore */
  }
}

/**
 * Handle a single HTTP CONNECT client connection.
 * @param {net.Socket} socket
 * @param {object} config
 * @param {object} logger
 * @param {Buffer} [initialChunk] - bytes the dispatcher already received.
 */
function handleHttpConnect(socket, config, logger, initialChunk) {
  const clientInfo = { client: `${socket.remoteAddress}:${socket.remotePort}` };

  let buffer = Buffer.alloc(0);
  let handled = false;

  function onData(chunk) {
    if (handled) return;
    buffer = Buffer.concat([buffer, chunk]);

    // Guard against oversized headers.
    if (buffer.length > 16 * 1024) {
      handled = true;
      socket.removeListener('data', onData);
      writeResponse(socket, '431 Request Header Fields Too Large');
      socket.destroy();
      return;
    }

    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return; // wait for full header block

    handled = true;
    socket.removeListener('data', onData);

    const headerText = buffer.subarray(0, headerEnd).toString('utf8');
    const lines = headerText.split('\r\n');
    const requestLine = lines[0] || '';
    const [method, target] = requestLine.split(/\s+/);

    if (!method || method.toUpperCase() !== 'CONNECT') {
      logger.warn('http non-CONNECT request rejected', { ...clientInfo, method });
      writeResponse(socket, '405 Method Not Allowed');
      socket.destroy();
      return;
    }

    // Parse headers into a case-insensitive map.
    const headers = {};
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const ci = line.indexOf(':');
      if (ci > 0) {
        headers[line.slice(0, ci).trim().toLowerCase()] = line.slice(ci + 1).trim();
      }
    }

    const creds = parseProxyAuth(headers['proxy-authorization']);
    if (!creds || !verifyCredentials(config, creds.user, creds.pass)) {
      logger.warn('http auth failed', { ...clientInfo, user: creds ? creds.user : null });
      writeResponse(socket, '407 Proxy Authentication Required', [
        'Proxy-Authenticate: Basic realm="EdgeBridge"',
      ]);
      socket.destroy();
      return;
    }

    // target is host:port
    const lastColon = target.lastIndexOf(':');
    if (lastColon < 0) {
      writeResponse(socket, '400 Bad Request');
      socket.destroy();
      return;
    }
    let destHost = target.slice(0, lastColon);
    const destPort = Number.parseInt(target.slice(lastColon + 1), 10);
    // Strip brackets from IPv6 literals like [::1]
    if (destHost.startsWith('[') && destHost.endsWith(']')) {
      destHost = destHost.slice(1, -1);
    }

    if (!destHost || !Number.isInteger(destPort) || destPort < 1 || destPort > 65535) {
      writeResponse(socket, '400 Bad Request');
      socket.destroy();
      return;
    }

    if (!isAllowed(config, destHost, destPort)) {
      logger.warn('http destination denied by allowlist', {
        ...clientInfo,
        user: creds.user,
        dest: `${destHost}:${destPort}`,
      });
      writeResponse(socket, '403 Forbidden');
      socket.destroy();
      return;
    }

    const upstream = net.connect({ host: destHost, port: destPort });

    upstream.once('connect', () => {
      logger.info('http connect', {
        ...clientInfo,
        user: creds.user,
        dest: `${destHost}:${destPort}`,
      });
      writeResponse(socket, '200 Connection Established');
      // Any bytes received after the header block belong to the tunnel.
      const leftover = buffer.subarray(headerEnd + 4);
      if (leftover.length > 0) upstream.write(leftover);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });

    upstream.on('error', (err) => {
      logger.warn('http upstream error', {
        ...clientInfo,
        dest: `${destHost}:${destPort}`,
        code: err.code,
      });
      if (!socket.destroyed) writeResponse(socket, '502 Bad Gateway');
      socket.destroy();
    });

    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
  }

  socket.on('data', onData);
  socket.on('error', (err) => logger.debug('http client error', { ...clientInfo, error: err.message }));

  // Feed the initial chunk the dispatcher already received (if any).
  if (initialChunk && initialChunk.length > 0) onData(initialChunk);
}

module.exports = { handleHttpConnect, parseProxyAuth };
