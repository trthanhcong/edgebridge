/**
 * EdgeBridge popup controller.
 *
 * Loads saved settings from chrome.storage.local, lets the user edit them,
 * and drives connect/disconnect by messaging the background service worker.
 * Credentials are stored via chrome.storage.local (not synced) and never
 * printed to the console or logged.
 */

const STORAGE_KEY = 'edgebridge.config';

const els = {
  host: document.getElementById('host'),
  port: document.getElementById('port'),
  scheme: document.getElementById('scheme'),
  schemeHint: document.getElementById('schemeHint'),
  authMode: document.getElementById('authMode'),
  userpassFields: document.getElementById('userpassFields'),
  tokenFields: document.getElementById('tokenFields'),
  username: document.getElementById('username'),
  password: document.getElementById('password'),
  token: document.getElementById('token'),
  connectBtn: document.getElementById('connectBtn'),
  disconnectBtn: document.getElementById('disconnectBtn'),
  message: document.getElementById('message'),
  statusDot: document.getElementById('statusDot'),
  statusLabel: document.getElementById('statusLabel'),
  connInfo: document.getElementById('connInfo'),
  connTarget: document.getElementById('connTarget'),
  connScheme: document.getElementById('connScheme'),
};

/* ------------------------------ utilities -------------------------------- */

function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(res);
      }
    });
  });
}

function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (res) => resolve(res[STORAGE_KEY] || {}));
  });
}

function saveConfig(cfg) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: cfg }, () => resolve());
  });
}

function showMessage(text, kind) {
  els.message.textContent = text;
  els.message.className = `message ${kind || 'info'}`;
  els.message.hidden = !text;
}

function clearMessage() {
  els.message.hidden = true;
  els.message.textContent = '';
}

/* ------------------------------ UI toggles ------------------------------- */

function applyAuthModeUI() {
  const mode = els.authMode.value;
  els.userpassFields.hidden = mode !== 'userpass';
  els.tokenFields.hidden = mode !== 'token';
}

function applySchemeHint() {
  if (els.scheme.value === 'socks5') {
    els.schemeHint.textContent =
      'SOCKS5: Chrome cannot inject SOCKS credentials automatically. Prefer HTTP CONNECT unless your gateway allows this client without a browser auth prompt.';
  } else {
    els.schemeHint.textContent =
      'HTTP CONNECT supports username/password auth in the browser.';
  }
}

function setConnectedUI(state) {
  const connected = !!(state && state.connected);
  els.statusDot.classList.toggle('connected', connected);
  els.statusLabel.textContent = connected ? 'Connected' : 'Disconnected';
  els.connectBtn.hidden = connected;
  els.disconnectBtn.hidden = !connected;

  if (connected) {
    els.connInfo.hidden = false;
    els.connTarget.textContent = `${state.host}:${state.port}`;
    els.connScheme.textContent = (state.scheme || 'http').toUpperCase();
  } else {
    els.connInfo.hidden = true;
  }

  // Lock the form while connected to avoid confusing mid-session edits.
  [els.host, els.port, els.scheme, els.authMode, els.username, els.password, els.token].forEach(
    (el) => {
      el.disabled = connected;
    }
  );

  if (state && state.error) {
    showMessage(state.error, 'error');
  }
}

/* ------------------------- read form into config ------------------------- */

function readForm() {
  return {
    host: els.host.value.trim(),
    port: Number(els.port.value),
    scheme: els.scheme.value,
    authMode: els.authMode.value,
    username: els.username.value,
    password: els.password.value,
    token: els.token.value,
  };
}

function validate(cfg) {
  if (!cfg.host) return 'Please enter the gateway host.';
  if (!cfg.port || cfg.port < 1 || cfg.port > 65535) return 'Please enter a valid port (1-65535).';
  if (cfg.authMode === 'token') {
    if (!cfg.token) return 'Please enter the token.';
  } else {
    if (!cfg.username) return 'Please enter the username.';
    if (!cfg.password) return 'Please enter the password.';
  }
  return null;
}

/* -------------------------------- events --------------------------------- */

els.authMode.addEventListener('change', applyAuthModeUI);
els.scheme.addEventListener('change', applySchemeHint);

els.connectBtn.addEventListener('click', async () => {
  clearMessage();
  const cfg = readForm();
  const err = validate(cfg);
  if (err) {
    showMessage(err, 'error');
    return;
  }

  await saveConfig(cfg);

  els.connectBtn.disabled = true;
  showMessage('Connecting…', 'info');

  const res = await sendMessage({ type: 'connect' });
  els.connectBtn.disabled = false;

  if (res && res.ok) {
    showMessage('Connected. Verify your IP to confirm traffic is routed.', 'success');
  } else {
    showMessage((res && res.error) || 'Failed to connect.', 'error');
  }
  await refreshState();
});

els.disconnectBtn.addEventListener('click', async () => {
  clearMessage();
  els.disconnectBtn.disabled = true;
  showMessage('Disconnecting…', 'info');

  const res = await sendMessage({ type: 'disconnect' });
  els.disconnectBtn.disabled = false;

  if (res && res.ok) {
    showMessage('Disconnected. Previous proxy settings restored.', 'success');
  } else {
    showMessage((res && res.error) || 'Failed to disconnect.', 'error');
  }
  await refreshState();
});

/* ------------------------------ bootstrap -------------------------------- */

async function refreshState() {
  const state = await sendMessage({ type: 'getState' });
  setConnectedUI(state);
}

async function init() {
  const cfg = await loadConfig();
  els.host.value = cfg.host || '';
  els.port.value = cfg.port || '';
  els.scheme.value = cfg.scheme || 'http';
  els.authMode.value = cfg.authMode || 'userpass';
  els.username.value = cfg.username || '';
  els.password.value = cfg.password || '';
  els.token.value = cfg.token || '';

  applyAuthModeUI();
  applySchemeHint();
  await refreshState();
}

init();
