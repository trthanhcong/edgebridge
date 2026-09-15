'use strict';

/**
 * Configuration loader for the EdgeBridge Gateway.
 *
 * All configuration is sourced from environment variables so that no
 * credentials or secrets are ever hard-coded. See `.env.example` for the
 * full list of supported variables.
 */

function parseUsers(raw) {
  // Format: "user1:pass1,user2:pass2"
  const map = new Map();
  if (!raw) return map;
  for (const pair of raw.split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue; // require a non-empty username and a separator
    const user = trimmed.slice(0, idx).trim();
    const pass = trimmed.slice(idx + 1); // password may contain nothing else special
    if (user) map.set(user, pass);
  }
  return map;
}

function parseList(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parsePorts(raw) {
  return parseList(raw)
    .map((p) => Number.parseInt(p, 10))
    .filter((n) => Number.isInteger(n) && n > 0 && n < 65536);
}

function loadConfig(env = process.env) {
  const authMode = (env.AUTH_MODE || 'userpass').toLowerCase();
  if (authMode !== 'userpass' && authMode !== 'token') {
    throw new Error(`Invalid AUTH_MODE "${authMode}". Must be "userpass" or "token".`);
  }

  const users = parseUsers(env.AUTH_USERS);
  const token = env.AUTH_TOKEN || '';

  // Validate that authentication is actually configured. We refuse to start an
  // open proxy: authentication is mandatory (security-first).
  if (authMode === 'userpass') {
    if (users.size === 0) {
      throw new Error(
        'AUTH_MODE=userpass but AUTH_USERS is empty. Refusing to start an unauthenticated proxy.'
      );
    }
    for (const [u, p] of users) {
      if (!p) throw new Error(`User "${u}" has an empty password. Refusing to start.`);
    }
  } else {
    if (!token || token.length < 8) {
      throw new Error(
        'AUTH_MODE=token but AUTH_TOKEN is missing or too short (min 8 chars). Refusing to start.'
      );
    }
  }

  const config = {
    port: Number.parseInt(env.PORT || '1080', 10),
    bindHost: env.BIND_HOST || '0.0.0.0',
    healthPort: Number.parseInt(env.HEALTH_PORT || '8080', 10),
    authMode,
    users, // Map<username, password>
    token,
    allowlist: parseList(env.ALLOWLIST || '*'),
    allowedPorts: parsePorts(env.ALLOWED_PORTS || ''),
    logLevel: (env.LOG_LEVEL || 'info').toLowerCase(),
  };

  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error(`Invalid PORT "${env.PORT}".`);
  }
  if (!Number.isInteger(config.healthPort) || config.healthPort < 1 || config.healthPort > 65535) {
    throw new Error(`Invalid HEALTH_PORT "${env.HEALTH_PORT}".`);
  }

  return config;
}

module.exports = { loadConfig, parseUsers, parseList, parsePorts };
