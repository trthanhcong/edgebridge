'use strict';

const crypto = require('crypto');

/**
 * Authentication helpers.
 *
 * Both SOCKS5 username/password auth and HTTP Basic auth ultimately reduce to
 * a (username, password) pair. In token mode the client sends username="token"
 * and password=<the token>, which lets a single credential model work across
 * both protocols and both auth modes.
 *
 * All comparisons use constant-time comparison to avoid timing side-channels.
 */

function safeEqual(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ab.length !== bb.length) {
    // Still perform a comparison against a same-length buffer to reduce timing
    // signal, then return false.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Verify a (username, password) credential pair against the configured auth.
 * @returns {boolean} true if authenticated.
 */
function verifyCredentials(config, username, password) {
  if (username == null || password == null) return false;

  if (config.authMode === 'token') {
    // Accept either username "token" (conventional) or any username, as long
    // as the password matches the shared token. Requiring the "token" username
    // keeps it predictable across clients.
    const userOk = safeEqual(username, 'token');
    const tokenOk = safeEqual(password, config.token);
    return userOk && tokenOk;
  }

  // userpass mode
  const expected = config.users.get(username);
  if (expected === undefined) {
    // Perform a dummy compare to keep timing roughly constant.
    safeEqual(password, password);
    return false;
  }
  return safeEqual(password, expected);
}

module.exports = { verifyCredentials, safeEqual };
