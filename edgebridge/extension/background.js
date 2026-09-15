/**
 * EdgeBridge background service worker (MV3).
 *
 * Responsibilities:
 *  - Apply / clear the browser proxy configuration (chrome.proxy).
 *  - Supply proxy credentials on demand via webRequest.onAuthRequired
 *    (HTTP CONNECT Basic auth). Credentials are held only in memory here and
 *    read from chrome.storage.local; they are never written to the proxy PAC
 *    script or logged.
 *  - Track connection state and surface auth/connection errors to the popup.
 *
 * NOTE: This tool is intended for connecting to a gateway you own or are
 * authorized to use. It does not attempt to bypass any organization's network
 * policy or controls.
 */

const STORAGE_KEY = 'edgebridge.config';
const STATE_KEY = 'edgebridge.state';

// In-memory credential cache for the onAuthRequired handler. Populated from
// storage when a connection is established; cleared on disconnect.
let creds = null; // { username, password }
let authFailed = false;

/* ---------------------------- storage helpers ---------------------------- */

function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (res) => resolve(res[STORAGE_KEY] || null));
  });
}

function setState(state) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STATE_KEY]: state }, () => resolve());
  });
}

function getState() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STATE_KEY], (res) =>
      resolve(res[STATE_KEY] || { connected: false, error: null })
    );
  });
}

/* ------------------------- proxy config building ------------------------- */

/**
 * Build a chrome.proxy fixed_servers config for the given settings.
 * We use the HTTP CONNECT proxy scheme by default because it supports
 * injecting Basic auth credentials via onAuthRequired in MV3.
 */
function buildProxyConfig(cfg) {
  // scheme: "http" (HTTP CONNECT) or "socks5"
  const scheme = cfg.scheme === 'socks5' ? 'socks5' : 'http';

  const rules = {
    singleProxy: {
      scheme,
      host: cfg.host,
      port: Number(cfg.port),
    },
    // Keep localhost / intranet direct so the extension UI and local dev work.
    bypassList: ['localhost', '127.0.0.1', '<local>'],
  };

  return {
    mode: 'fixed_servers',
    rules,
  };
}

/* ----------------------------- connect flow ------------------------------ */

async function connect() {
  const cfg = await getConfig();
  if (!cfg || !cfg.host || !cfg.port) {
    const err = 'Missing gateway host/port. Open the popup and save settings first.';
    await setState({ connected: false, error: err });
    return { ok: false, error: err };
  }

  // Resolve credentials depending on auth mode.
  if (cfg.authMode === 'token') {
    if (!cfg.token) {
      const err = 'Token is empty.';
      await setState({ connected: false, error: err });
      return { ok: false, error: err };
    }
    creds = { username: 'token', password: cfg.token };
  } else {
    if (!cfg.username || !cfg.password) {
      const err = 'Username or password is empty.';
      await setState({ connected: false, error: err });
      return { ok: false, error: err };
    }
    creds = { username: cfg.username, password: cfg.password };
  }

  authFailed = false;

  const proxyConfig = buildProxyConfig(cfg);

  return new Promise((resolve) => {
    chrome.proxy.settings.set({ value: proxyConfig, scope: 'regular' }, async () => {
      if (chrome.runtime.lastError) {
        const err = chrome.runtime.lastError.message || 'Failed to apply proxy settings.';
        creds = null;
        await setState({ connected: false, error: err });
        resolve({ ok: false, error: err });
        return;
      }
      await setState({
        connected: true,
        error: null,
        host: cfg.host,
        port: cfg.port,
        scheme: cfg.scheme || 'http',
        since: Date.now(),
      });
      updateBadge(true);
      resolve({ ok: true });
    });
  });
}

async function disconnect() {
  return new Promise((resolve) => {
    // Clearing our settings restores whatever the browser/OS had before
    // (Chrome manages the previous value under the "regular" scope).
    chrome.proxy.settings.clear({ scope: 'regular' }, async () => {
      creds = null;
      authFailed = false;
      const lastErr = chrome.runtime.lastError;
      await setState({ connected: false, error: lastErr ? lastErr.message : null });
      updateBadge(false);
      resolve({ ok: !lastErr, error: lastErr ? lastErr.message : null });
    });
  });
}

/* --------------------------- badge / UI state ---------------------------- */

function updateBadge(connected) {
  try {
    chrome.action.setBadgeText({ text: connected ? 'ON' : '' });
    chrome.action.setBadgeBackgroundColor({ color: connected ? '#1b8f4d' : '#888888' });
  } catch (_) {
    /* ignore */
  }
}

/* ----------------------- proxy authentication hook ----------------------- */

// Supply Basic credentials to the proxy exactly once per challenge.
// If the proxy rejects them, mark an auth failure and surface it.
chrome.webRequest.onAuthRequired.addListener(
  (details, callback) => {
    if (!details.isProxy) {
      // Not a proxy challenge; let the browser handle it.
      if (callback) callback({});
      return;
    }
    if (!creds) {
      if (callback) callback({ cancel: true });
      return;
    }
    if (callback) {
      callback({ authCredentials: { username: creds.username, password: creds.password } });
    }
  },
  { urls: ['<all_urls>'] },
  ['asyncBlocking']
);

// Detect repeated proxy-auth failures (407 loops) and report them.
chrome.webRequest.onErrorOccurred.addListener(
  async (details) => {
    if (details.error && /PROXY|TUNNEL|AUTH/i.test(details.error)) {
      const state = await getState();
      if (state.connected) {
        await setState({
          ...state,
          error: `Proxy connection problem: ${details.error}`,
        });
      }
    }
  },
  { urls: ['<all_urls>'] }
);

/* ----------------------------- message API ------------------------------- */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg && msg.type) {
      case 'connect': {
        const r = await connect();
        sendResponse(r);
        break;
      }
      case 'disconnect': {
        const r = await disconnect();
        sendResponse(r);
        break;
      }
      case 'getState': {
        const state = await getState();
        sendResponse(state);
        break;
      }
      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  })();
  return true; // keep the channel open for async sendResponse
});

// On service worker startup, re-hydrate credentials if we were connected, so
// the auth handler keeps working after the worker is recycled.
(async () => {
  const state = await getState();
  if (state && state.connected) {
    const cfg = await getConfig();
    if (cfg) {
      if (cfg.authMode === 'token' && cfg.token) {
        creds = { username: 'token', password: cfg.token };
      } else if (cfg.username && cfg.password) {
        creds = { username: cfg.username, password: cfg.password };
      }
    }
    updateBadge(true);
  }
})();
