'use strict';

/**
 * Minimal leveled logger.
 *
 * IMPORTANT: This logger records connection metadata only (who connected,
 * where they wanted to go, allow/deny decisions). It never logs the contents
 * of proxied traffic.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function createLogger(level = 'info') {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function emit(lvl, msg, meta) {
    if (LEVELS[lvl] > threshold) return;
    const line = {
      ts: new Date().toISOString(),
      level: lvl,
      msg,
      ...(meta || {}),
    };
    const out = lvl === 'error' || lvl === 'warn' ? process.stderr : process.stdout;
    out.write(JSON.stringify(line) + '\n');
  }

  return {
    error: (msg, meta) => emit('error', msg, meta),
    warn: (msg, meta) => emit('warn', msg, meta),
    info: (msg, meta) => emit('info', msg, meta),
    debug: (msg, meta) => emit('debug', msg, meta),
  };
}

module.exports = { createLogger };
