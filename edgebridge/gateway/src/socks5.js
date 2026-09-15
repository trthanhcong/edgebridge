'use strict';

const net = require('net');
const { verifyCredentials } = require('./auth');
const { isAllowed } = require('./access');

/**
 * SOCKS5 server handler (RFC 1928 + RFC 1929 username/password auth).
 *
 * Only the CONNECT command is supported (TCP). BIND and UDP ASSOCIATE are
 * rejected. Username/password authentication is always required.
 *
 * Implementation note: rather than reading a fixed number of bytes at a time
 * (which is fragile when data is pipelined), this handler accumulates all
 * inbound bytes into a single buffer and advances through the handshake as a
 * state machine. Any bytes that arrive after the handshake completes are
 * forwarded to the upstream connection.
 */

// SOCKS5 constants
const VERSION = 0x05;
const AUTH_USERPASS = 0x02;
const CMD_CONNECT = 0x01;
const ATYP_IPV4 = 0x01;
const ATYP_DOMAIN = 0x03;
const ATYP_IPV6 = 0x04;

// Reply codes
const REP_SUCCESS = 0x00;
const REP_GENERAL_FAILURE = 0x01;
const REP_NOT_ALLOWED = 0x02;
const REP_HOST_UNREACHABLE = 0x04;
const REP_CONN_REFUSED = 0x05;
const REP_CMD_NOT_SUPPORTED = 0x07;
const REP_ATYP_NOT_SUPPORTED = 0x08;

// Handshake states
const S_GREETING = 0;
const S_AUTH = 1;
const S_REQUEST = 2;
const S_TUNNEL = 3;

function sendReply(socket, rep) {
  // Reply with a bound address of 0.0.0.0:0 (acceptable for CONNECT clients).
  const buf = Buffer.from([VERSION, rep, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0]);
  try {
    socket.write(buf);
  } catch (_) {
    /* ignore */
  }
}

/**
 * Handle a single SOCKS5 client connection.
 * @param {net.Socket} socket
 * @param {Buffer} initialChunk - the first chunk already received (starts 0x05).
 * @param {object} config
 * @param {object} logger
 */
function handleSocks5(socket, initialChunk, config, logger) {
  const clientInfo = { client: `${socket.remoteAddress}:${socket.remotePort}` };

  let state = S_GREETING;
  let buf = Buffer.alloc(0);
  let username = '';
  let upstream = null;
  let finished = false;

  function fail(rep) {
    if (!finished && rep != null) sendReply(socket, rep);
    finished = true;
    socket.destroy();
  }

  // Try to advance the state machine as far as the current buffer allows.
  function process() {
    // ---- GREETING: VER, NMETHODS, METHODS... ----
    if (state === S_GREETING) {
      if (buf.length < 2) return;
      if (buf[0] !== VERSION) return fail(null);
      const nMethods = buf[1];
      if (buf.length < 2 + nMethods) return;
      buf = buf.subarray(2 + nMethods);
      // Require username/password auth — no anonymous access.
      socket.write(Buffer.from([VERSION, AUTH_USERPASS]));
      state = S_AUTH;
    }

    // ---- AUTH (RFC 1929): VER(1) ULEN(1) UNAME PLEN(1) PASSWD ----
    if (state === S_AUTH) {
      if (buf.length < 2) return;
      if (buf[0] !== 0x01) {
        socket.write(Buffer.from([0x01, 0x01]));
        return fail(null);
      }
      const ulen = buf[1];
      if (buf.length < 2 + ulen + 1) return;
      const uname = buf.subarray(2, 2 + ulen).toString('utf8');
      const plen = buf[2 + ulen];
      if (buf.length < 2 + ulen + 1 + plen) return;
      const passwd = buf.subarray(3 + ulen, 3 + ulen + plen).toString('utf8');
      buf = buf.subarray(3 + ulen + plen);

      if (!verifyCredentials(config, uname, passwd)) {
        logger.warn('socks5 auth failed', { ...clientInfo, user: uname });
        socket.write(Buffer.from([0x01, 0x01])); // auth failure
        return fail(null);
      }
      username = uname;
      socket.write(Buffer.from([0x01, 0x00])); // auth success
      state = S_REQUEST;
    }

    // ---- REQUEST: VER CMD RSV ATYP DST.ADDR DST.PORT ----
    if (state === S_REQUEST) {
      if (buf.length < 4) return;
      if (buf[0] !== VERSION) return fail(REP_GENERAL_FAILURE);
      const cmd = buf[1];
      const atyp = buf[3];

      let destHost;
      let offset;
      if (atyp === ATYP_IPV4) {
        if (buf.length < 4 + 4 + 2) return;
        destHost = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`;
        offset = 8;
      } else if (atyp === ATYP_DOMAIN) {
        if (buf.length < 5) return;
        const len = buf[4];
        if (buf.length < 5 + len + 2) return;
        destHost = buf.subarray(5, 5 + len).toString('utf8');
        offset = 5 + len;
      } else if (atyp === ATYP_IPV6) {
        if (buf.length < 4 + 16 + 2) return;
        const parts = [];
        for (let i = 0; i < 16; i += 2) parts.push(buf.readUInt16BE(4 + i).toString(16));
        destHost = parts.join(':');
        offset = 20;
      } else {
        return fail(REP_ATYP_NOT_SUPPORTED);
      }

      const destPort = buf.readUInt16BE(offset);
      buf = buf.subarray(offset + 2); // any leftover belongs to the tunnel

      if (cmd !== CMD_CONNECT) {
        logger.warn('socks5 unsupported command', { ...clientInfo, cmd });
        return fail(REP_CMD_NOT_SUPPORTED);
      }

      if (!isAllowed(config, destHost, destPort)) {
        logger.warn('socks5 destination denied by allowlist', {
          ...clientInfo,
          user: username,
          dest: `${destHost}:${destPort}`,
        });
        return fail(REP_NOT_ALLOWED);
      }

      state = S_TUNNEL;
      openUpstream(destHost, destPort);
    }
  }

  function openUpstream(destHost, destPort) {
    upstream = net.connect({ host: destHost, port: destPort });

    upstream.once('connect', () => {
      logger.info('socks5 connect', {
        ...clientInfo,
        user: username,
        dest: `${destHost}:${destPort}`,
      });
      sendReply(socket, REP_SUCCESS);

      // Flush any bytes that arrived after the request header.
      if (buf.length > 0) {
        upstream.write(buf);
        buf = Buffer.alloc(0);
      }

      // Switch to raw piping for the rest of the session.
      socket.removeListener('data', onData);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });

    upstream.on('error', (err) => {
      let rep = REP_GENERAL_FAILURE;
      if (err.code === 'ECONNREFUSED') rep = REP_CONN_REFUSED;
      else if (err.code === 'ENOTFOUND' || err.code === 'EHOSTUNREACH') rep = REP_HOST_UNREACHABLE;
      logger.warn('socks5 upstream error', {
        ...clientInfo,
        dest: `${destHost}:${destPort}`,
        code: err.code,
      });
      fail(rep);
    });

    upstream.on('close', () => socket.destroy());
  }

  function onData(chunk) {
    if (finished) return;
    buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
    try {
      process();
    } catch (err) {
      logger.debug('socks5 handler error', { ...clientInfo, error: err.message });
      fail(REP_GENERAL_FAILURE);
    }
  }

  socket.on('data', onData);
  socket.on('error', () => {
    finished = true;
    if (upstream) upstream.destroy();
  });
  socket.on('close', () => {
    finished = true;
    if (upstream) upstream.destroy();
  });

  // Feed the initial chunk that the dispatcher already received.
  onData(initialChunk);
}

module.exports = { handleSocks5 };
