# Remote Access

AgentLine runs on your development machine. To access it from your phone or another device outside your local network, you'll need to set up remote access.

## Secure Relay

The easiest way to access AgentLine remotely. Zero-config, no port forwarding required.

**Setup via Settings UI:**
1. Go to Settings → Remote Access
2. Enter a username and password
3. Connect from anywhere at `agentline.com/remote`

**Setup via CLI (for headless/automated deployments):**
```bash
agentline --setup-remote-access --username myserver --password "secretpass123"
```

**How it works:**
- Your agentline server connects to our public relay
- Your phone connects to the same relay and authenticates with SRP-6a (zero-knowledge password proof)
- All traffic is end-to-end encrypted with TweetNaCl — the relay only sees opaque blobs
- You can [run your own relay](relay-design.md) if you prefer

**Security:**
- The relay never sees your password or session keys
- Traffic is encrypted with XSalsa20-Poly1305 (same as Signal, Keybase, etc.)
- No accounts or sign-ups required — just a username/password you control

See [relay-design.md](relay-design.md) for technical details.

---

## Self-Hosted Relay from Source

The relay service lives in `packages/relay/` and depends on the workspace package in `packages/shared/`. Prefer directory-based pnpm filters so these commands keep working if package names change.

Run from the repository root:

```bash
corepack enable
pnpm install --frozen-lockfile

pnpm --filter ./packages/shared build
pnpm --filter ./packages/relay build

NODE_ENV=production \
RELAY_PORT=4400 \
RELAY_DATA_DIR=$HOME/.agentline-relay \
node packages/relay/dist/index.js
```

Verify the relay:

```bash
curl http://127.0.0.1:4400/health
```

For local testing, configure AgentLine to use:

```bash
agentline --setup-remote-access \
  --username myserver \
  --password "secretpass123" \
  --relay ws://127.0.0.1:4400/ws
```

For public access, put Caddy, Nginx, or another TLS reverse proxy in front of the relay and use a `wss://` URL:

```text
wss://relay.yourdomain.com/ws
```

### Railway Deployment

Deploy the repository root as a Railway service. Do not set the service root to `packages/relay`, because the relay imports the shared workspace package.

Use these service settings:

```text
Root Directory: /
Build Command: pnpm install --frozen-lockfile && pnpm --filter ./packages/shared build && pnpm --filter ./packages/client build:remote && pnpm --filter ./packages/relay build
Start Command: RELAY_PORT=$PORT NODE_ENV=production RELAY_DATA_DIR=/data RELAY_REMOTE_CLIENT_DIST_DIR=packages/client/dist-remote node packages/relay/dist/index.js
```

Recommended Railway variables:

```text
NODE_ENV=production
RELAY_LOG_TO_CONSOLE=true
RELAY_LOG_TO_FILE=false
RELAY_TELEMETRY_ENABLED=true
RELAY_REMOTE_CLIENT_DIST_DIR=packages/client/dist-remote
```

Add a Railway volume mounted at `/data` if username ownership and telemetry should persist across redeploys. Without a volume, the relay still runs, but its SQLite registry is ephemeral.

After Railway deploys, use the Railway HTTPS domain as a WebSocket URL:

```text
https://example.up.railway.app  ->  wss://example.up.railway.app/ws
```

Then configure AgentLine:

```bash
agentline --setup-remote-access \
  --username myserver \
  --password "secretpass123" \
  --relay wss://example.up.railway.app/ws
```

---

## Alternative Options

If you prefer not to use the relay, here are other options. All require you to trust some external party with routing your traffic.

## Option 1: Tailscale (Recommended)

[Tailscale](https://tailscale.com) creates a private network between your devices. Zero port forwarding, zero firewall config.

**Setup:**
1. Install Tailscale on your dev machine and phone
2. Sign in with the same account on both
3. Access AgentLine at `http://<tailscale-ip>:3400`

**Pros:** Dead simple, encrypted, works behind NAT, free for personal use
**Cons:** Requires Tailscale account, app on each device

**Note:** On Chromebooks, the Tailscale Android app may have installation issues. Consider the Cloudflare Tunnel option instead.

## Option 2: Cloudflare Tunnel

[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) exposes your local server through Cloudflare's network. No port forwarding needed.

**Setup:**
1. Create a free Cloudflare account
2. Add a domain (or use a free `*.trycloudflare.com` URL for testing)
3. Install `cloudflared` on your dev machine:
   ```bash
   # macOS
   brew install cloudflared

   # Linux
   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
   chmod +x cloudflared
   ```
4. Run the tunnel:
   ```bash
   # Quick test (random URL, no account needed)
   cloudflared tunnel --url http://localhost:3400

   # Persistent (requires CF account + domain)
   cloudflared tunnel create agentline
   cloudflared tunnel route dns agentline claude.yourdomain.com
   cloudflared tunnel run agentline
   ```

**Pros:** Free, handles HTTPS automatically, no port forwarding
**Cons:** Requires Cloudflare account for persistent URLs

## Option 3: Caddy + SSH Tunnel (Self-Hosted)

If you have a server with a public IP (like a Raspberry Pi with port 443 forwarded), you can use Caddy for HTTPS and an SSH tunnel for connectivity.

**On your public-facing server (e.g., Raspberry Pi):**
1. Install [Caddy](https://caddyserver.com)
2. Point a DNS A record to your home IP
3. Create `/etc/caddy/Caddyfile`:
   ```
   claude.yourdomain.com {
       reverse_proxy 127.0.0.1:3400
       basicauth /* {
           youruser $2a$14$hashedpassword
       }
   }
   ```
   Generate the password hash with `caddy hash-password`
4. Start Caddy: `sudo caddy start --config /etc/caddy/Caddyfile`

**On your dev machine:**
Set up a reverse SSH tunnel to forward the local port to the server:
```bash
# One-time
ssh -N -R 3400:localhost:3400 yourserver

# Persistent (install autossh)
autossh -M 0 -N -o "ServerAliveInterval 30" -o "ServerAliveCountMax 3" \
    -R 3400:localhost:3400 yourserver
```

For a systemd service, create `~/.config/systemd/user/claude-tunnel.service`:
```ini
[Unit]
Description=SSH tunnel for AgentLine
After=network.target

[Service]
ExecStart=/usr/bin/autossh -M 0 -N -o "ServerAliveInterval 30" -o "ServerAliveCountMax 3" -R 3400:localhost:3400 yourserver
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
```

Then:
```bash
systemctl --user enable claude-tunnel
systemctl --user start claude-tunnel
```

**Pros:** Full control, no third-party accounts
**Cons:** More complex setup, requires existing server infrastructure

## Security Considerations

- AgentLine has access to your codebase. Only use remote access methods you trust.
- Always use HTTPS for remote access (all options above provide this).
- Consider adding authentication (basic auth, Cloudflare Access, etc.) as an extra layer.
- The server listens on localhost by default. Remote access methods tunnel to localhost rather than exposing on all interfaces.
