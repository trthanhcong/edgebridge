# EdgeBridge Extension (Chrome / Brave, Manifest V3)

This directory contains the unpacked extension. It configures the browser to
route traffic through an EdgeBridge gateway you own or are authorized to use.

## Load it (developer mode)

1. Open `chrome://extensions` (Chrome) or `brave://extensions` (Brave).
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Pin the EdgeBridge icon to the toolbar.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest, permissions, action popup. |
| `background.js` | Service worker: applies/clears proxy, supplies proxy Basic auth via `webRequest.onAuthRequired`, tracks state. |
| `popup/popup.html` | Popup markup. |
| `popup/popup.css` | Popup styling. |
| `popup/popup.js` | Popup logic: load/save settings, connect/disconnect, status. |
| `icons/*` | Toolbar icons. |

## Permissions rationale

- `proxy` — set/clear the browser proxy configuration.
- `storage` — persist gateway settings and connection state in `chrome.storage.local`.
- `webRequest` + `webRequestAuthProvider` — answer the proxy's Basic-auth
  challenge with your credentials so you are not prompted on every request.
- `host_permissions: <all_urls>` — required for the auth handler to respond to
  proxy challenges on any destination.

## Notes on protocols

- **HTTP CONNECT (recommended):** Chrome/Brave can inject your username/password
  automatically, so this is the smoothest experience.
- **SOCKS5:** Chromium cannot auto-supply SOCKS credentials, so prefer HTTP
  CONNECT unless your gateway is reachable by this client without a browser auth
  prompt.

Credentials are stored via `chrome.storage.local` (device-local, not synced).
