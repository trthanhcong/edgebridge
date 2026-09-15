'use strict';

/**
 * Destination access control (allowlist).
 *
 * A destination is permitted only if:
 *   1. Its host matches at least one allowlist pattern, AND
 *   2. Its port is in ALLOWED_PORTS (or ALLOWED_PORTS is empty = all ports).
 *
 * Allowlist pattern forms:
 *   "*"              -> matches any host
 *   "*.example.com"  -> matches example.com and any subdomain
 *   "example.com"    -> matches exactly example.com (case-insensitive)
 */

function hostMatches(pattern, host) {
  const p = pattern.toLowerCase();
  const h = host.toLowerCase();
  if (p === '*') return true;
  if (p.startsWith('*.')) {
    const suffix = p.slice(1); // ".example.com"
    return h === p.slice(2) || h.endsWith(suffix);
  }
  return h === p;
}

function isAllowed(config, host, port) {
  if (!host) return false;

  const hostOk = config.allowlist.some((pat) => hostMatches(pat, host));
  if (!hostOk) return false;

  if (config.allowedPorts.length > 0 && !config.allowedPorts.includes(port)) {
    return false;
  }
  return true;
}

module.exports = { isAllowed, hostMatches };
