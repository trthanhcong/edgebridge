# EdgeBridge

EdgeBridge is a small, self-hosted proxy you run on a machine you own (for
example a PC or laptop at home) plus a Chrome/Brave extension that routes your
browser through it. It speaks both **SOCKS5** and **HTTP CONNECT** on a single
port, requires authentication, and enforces a destination allowlist.

> **Intended use.** EdgeBridge is for connecting to a gateway you own or are
> explicitly authorized to use (e.g. reaching your own home network or a lab
> environment). It is **not** intended to bypass, evade, or defeat the network
> policies or security controls of any organization. Only run it where you are
> permitted to do so.

```text
Chrome/Brave Extension
        │
        │  SOCKS5 / HTTP CONNECT (authenticated)
        ▼
   Public Internet
        │
        ▼
  HOME Gateway Server
        │
        ▼
    Internet
```

## Repository layout

```text
edgebridge/
├── gateway/            # Node.js proxy server (SOCKS5 + HTTP CONNECT)
│   ├── src/            #   config, auth, access control, protocol handlers
│   ├── healthcheck.js  #   Docker health probe
│   ├── Dockerfile
│   └── package.json
├── extension/          # Manifest V3 browser extension
│   ├── manifest.json
│   ├── background.js
│   ├── popup/
│   └── icons/
├── docker-compose.yml
├── .env.example
└── README.md
```

## Features

- SOCKS5 (RFC 1928/1929) **and** HTTP CONNECT on one port.
- Mandatory authentication: `username/password` **or** shared `token`.
  The server refuses to start if auth isn't configured (no open proxy).
- Destination **allowlist** (host patterns) and optional port allowlist.
- Unauthenticated **health-check** endpoint on a separate port.
- Connection metadata logging only — **no traffic content is logged**.
- Zero third-party runtime dependencies (Node.js built-ins only).
- Docker / docker-compose for one-command startup.
- No credentials or secrets are hard-coded; everything comes from env vars.

---

## Prerequisites

- **Docker** (recommended) — for the gateway. *or* **Node.js 18+** to run it
  directly.
- **Chrome or Brave** — for the extension.

---

## 1. Build & configure the Gateway

From the repo root:

```bash
cd edgebridge
cp .env.example .env
```

Edit `.env` and set **real** values. At minimum:

```dotenv
PORT=1080
HEALTH_PORT=8080
BIND_HOST=0.0.0.0

# Username/password mode:
AUTH_MODE=userpass
AUTH_USERS=alice:S0me-Strong-Passphrase

# ...or token mode:
# AUTH_MODE=token
# AUTH_TOKEN=a-long-random-string-at-least-8-chars

# Restrict where the proxy may connect (recommended):
ALLOWLIST=*.example.com,api.ipify.org,ifconfig.me
ALLOWED_PORTS=80,443
```

Generate a strong token/password, e.g.:

```bash
# Linux/macOS
openssl rand -base64 24
# Windows PowerShell
[Convert]::ToBase64String((1..24 | ForEach-Object { Get-Random -Max 256 }))
```

> Never commit your `.env`. It is already covered by `.gitignore`.

---

## 2. Start the Gateway

### Option A — Docker Compose (recommended)

```bash
docker compose up -d --build
```

Check it's healthy:

```bash
docker compose ps
curl http://localhost:8080/health
# {"status":"ok","service":"edgebridge-gateway",...}
```

View connection logs (metadata only):

```bash
docker compose logs -f gateway
```

Stop it:

```bash
docker compose down
```

### Option B — Node.js directly

```bash
cd gateway
# no npm install needed (no external deps)
# On Linux/macOS load .env into the environment, then start:
set -a; . ../.env; set +a
npm start
```

On Windows PowerShell you can set the vars inline:

```powershell
$env:AUTH_MODE="userpass"; $env:AUTH_USERS="alice:S0me-Strong-Passphrase"; node src/index.js
```

---

## 3. Expose the Gateway to the internet

Your browser (on the company machine) must be able to reach the gateway over
the public internet. Choose whichever you're authorized to use:

- **Port forwarding** on your home router: forward external `PORT` → the
  gateway host's `PORT`. Note your public IP (or set up dynamic DNS).
- **A tunnel** such as `cloudflared`, `ngrok`, or a Tailscale/WireGuard mesh.
  A tunnel avoids opening router ports and often gives you a stable hostname.

Security checklist when exposing:

- Keep `AUTH_MODE` set and use a strong credential/token.
- Prefer a tight `ALLOWLIST` and `ALLOWED_PORTS=80,443`.
- Consider putting the proxy behind a tunnel with its own TLS/hostname.
- The health port (`8080`) does not require auth; you generally do **not** need
  to expose it publicly — keep it local.

Verify remote reachability (from another network):

```bash
curl http://<PUBLIC_HOST>:8080/health
```

---

## 4. Install the Extension (Chrome / Brave)

1. Open `chrome://extensions` (Chrome) or `brave://extensions` (Brave).
2. Enable **Developer mode**.
3. Click **Load unpacked** → select the `edgebridge/extension` folder.
4. Pin **EdgeBridge** to the toolbar.

---

## 5. Configure & Connect

Click the EdgeBridge toolbar icon and fill in:

- **Gateway host** — your public host/IP or tunnel hostname.
- **Gateway port** — the exposed `PORT` (e.g. `1080`).
- **Proxy protocol** — **HTTP CONNECT** (recommended) or SOCKS5.
- **Authentication** — Username/Password or Token, matching your `.env`.

Then press **Connect**. The status dot turns green and the badge shows `ON`.

### Disconnect

Press **Disconnect**. EdgeBridge clears its proxy settings, which restores the
browser's previous proxy configuration. The badge clears.

---

## 6. Test that traffic is routed (IP check)

Before connecting, note your current public IP, then connect and check again.

- Visit `https://api.ipify.org` or `https://ifconfig.me/ip` in the browser.
- Before **Connect**: shows the company network's egress IP.
- After **Connect**: shows your **home gateway's** egress IP.

If both match your home IP after connecting, traffic is flowing through the
gateway. (If you set an `ALLOWLIST`, make sure the IP-check host is included,
e.g. `api.ipify.org` / `ifconfig.me`.)

You can also confirm from the gateway logs — each tunnel prints a
`socks5 connect` / `http connect` line with the destination (no content).

---

## Configuration reference

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `1080` | Proxy port (SOCKS5 + HTTP CONNECT share it). |
| `BIND_HOST` | `0.0.0.0` | Bind address. `127.0.0.1` = local only. |
| `HEALTH_PORT` | `8080` | Health-check HTTP port. |
| `AUTH_MODE` | `userpass` | `userpass` or `token`. |
| `AUTH_USERS` | — | `user1:pass1,user2:pass2` (userpass mode). |
| `AUTH_TOKEN` | — | Shared token, min 8 chars (token mode). |
| `ALLOWLIST` | `*` | Comma list of host patterns. `*`, `*.d.com`, `host`. |
| `ALLOWED_PORTS` | (all) | Comma list of allowed destination ports. |
| `LOG_LEVEL` | `info` | `error` / `warn` / `info` / `debug`. |

**Token mode client credentials:** username = `token`, password = `<AUTH_TOKEN>`.
The extension fills this in automatically when you choose Token.

---

## How authentication works across protocols

- **SOCKS5:** username/password auth per RFC 1929.
- **HTTP CONNECT:** HTTP Basic via the `Proxy-Authorization` header. The
  extension answers the proxy's `407` challenge using
  `webRequest.onAuthRequired`, so you're not prompted per request.
- Credential comparisons on the server use constant-time comparison.

Because Chromium cannot auto-supply SOCKS credentials, **HTTP CONNECT is the
recommended protocol** for the extension.

---

## Security notes

- Auth is mandatory; the gateway will not start as an open proxy.
- Keep the allowlist as narrow as your use case allows.
- Only connection metadata is logged — never request/response bodies.
- The container runs as a non-root user.
- Secrets live only in `.env` / environment variables and (on the client) in
  device-local `chrome.storage.local`.

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Popup shows "Failed to apply proxy settings" | Another extension controls the proxy, or the browser is managed by policy. Disable conflicting proxy extensions. |
| Pages fail with a proxy auth error | Wrong username/password/token, or gateway `AUTH_MODE` mismatch. Re-check `.env` and the popup. |
| `403 Forbidden` / connection denied in logs | Destination not in `ALLOWLIST`, or port not in `ALLOWED_PORTS`. |
| `curl /health` fails remotely | Health port not exposed (by design). Test the proxy port instead, or check locally. |
| Gateway won't start | Read the `[FATAL] Configuration error` message — usually missing auth config. |
| IP unchanged after Connect | Destination bypassed (localhost/intranet), or connect didn't apply. Check badge = `ON` and try an external site. |

---

## Manual proxy test without the extension

You can validate the gateway with `curl` using HTTP CONNECT:

```bash
# userpass mode
curl -x http://alice:S0me-Strong-Passphrase@localhost:1080 https://api.ipify.org

# token mode
curl -x http://token:YOUR_TOKEN@localhost:1080 https://api.ipify.org
```

Or SOCKS5:

```bash
curl --socks5-hostname alice:S0me-Strong-Passphrase@localhost:1080 https://api.ipify.org
```

## License

MIT.
