# Phase 4: ChatGPT Integration via OpenAI Secure MCP Tunnel

## Goal

Connect the local `firecrawl-mcp` server (`http://localhost:<MCP_PORT>/mcp`) to ChatGPT using the official OpenAI Secure MCP Tunnel (`tunnel-client`), with automated local process orchestration, readiness verification via loopback health endpoints, diagnostics, and conservative ownership tracking on Windows 11.

## Scope

In scope:
- Extend configuration (`src/config/index.ts` and `.env.example`) for OpenAI Secure MCP Tunnel settings (`CONTROL_PLANE_TUNNEL_ID`, `TUNNEL_CLIENT_BIN`, `TUNNEL_HEALTH_PORT`, and runtime API key presence detection via `CONTROL_PLANE_API_KEY` / `OPENAI_API_KEY` without storing or logging secret values)
- Extend persistent runtime state (`src/shared/state.ts`) with `tunnel` ownership and process metadata
- Implement `tunnel-client` binary resolution and version verification on Windows (`src/tunnel/process.ts`)
- Implement detached background process spawning, PID identity verification, and safe Windows termination for `tunnel-client` (`src/tunnel/process.ts`)
- Implement loopback-only tunnel readiness and status probing against `/readyz`, `/healthz`, `/api/status`, and `/health?details=true` (`src/tunnel/health.ts`)
- Implement tunnel lifecycle orchestration (`ensureTunnelRunning`, `stopManagedTunnel`, `runTunnelDoctorChecks`) (`src/tunnel/lifecycle.ts`, `src/tunnel/index.ts`)
- Integrate tunnel lifecycle into `pnpm start`, `pnpm doctor`, and `pnpm stop` (stopping Tunnel -> MCP -> Firecrawl)
- Add Vitest unit tests (`tests/tunnel.test.ts`, plus updates to `tests/config.test.ts` and `tests/state.test.ts`)

Out of scope:
- Public inbound tunnels (no `ngrok`, `cloudflared` public ingress, or port forwarding)
- Automating OpenAI Platform tunnel creation (`OPENAI_ADMIN_KEY` CRUD) or browser automation of ChatGPT UI
- Persisting or logging API keys anywhere on disk or stdout/stderr

---

## Research & Design Decisions

### 1. Official OpenAI Secure MCP Tunnel Architecture

Based on the official OpenAI Secure MCP Tunnel guide (`developers.openai.com/api/docs/guides/secure-mcp-tunnels`) and `openai/tunnel-client` (`v0.0.16`):

```text
ChatGPT (Custom MCP Plugin, Connection: Tunnel)
  │
  ▼
OpenAI Tunnel Service (https://api.openai.com/v1/tunnels/<tunnel_id>/*)
  ▲
  │ Outbound-only HTTPS long-poll (GET /poll, POST /response)
  │ Authenticated via CONTROL_PLANE_API_KEY
  │
tunnel-client.exe (local Windows process)
  ├─ Loopback Admin/Health Server: http://127.0.0.1:<TUNNEL_HEALTH_PORT> (/readyz, /healthz, /api/status, /ui)
  │
  ▼ Local HTTP Streamable MCP forwarding (channel=main)
Official firecrawl-mcp (http://localhost:<MCP_PORT>/mcp)
  │
  ▼ Local HTTP API (FIRECRAWL_API_URL)
Self-hosted Firecrawl (http://localhost:3002)
```

- **No public inbound endpoint**: `tunnel-client` opens an outbound-only HTTPS connection to `https://api.openai.com:443`, long-polls for queued MCP JSON-RPC requests on the configured `tunnel_id`, forwards them to `http://localhost:<MCP_PORT>/mcp`, and posts responses back through the tunnel.
- **Transport choice**: Because `openai-firecrawl` already runs and verifies `firecrawl-mcp` in Streamable HTTP mode on `http://localhost:<MCP_PORT>/mcp` (Phase 3), `tunnel-client` will bind its `main` channel via `--mcp.server-url=http://localhost:<MCP_PORT>/mcp` (`MCP_SERVER_URL`). This avoids `tunnel-client`'s single-instance stdio child limitations and allows independent inspection of MCP and Tunnel health.

### 2. Installing and Resolving `tunnel-client` on Windows

Per `openai/tunnel-client` release documentation:
- Official Windows binaries are published as `tunnel-client-vX.Y.Z-windows-amd64.zip` (and `windows-arm64.zip`) at `https://github.com/openai/tunnel-client/releases/latest` and linked from `https://platform.openai.com/settings/organization/tunnels`.
- Consistent with `openai/tunnel-client`'s own binary policy (`references/binary.md`: *"Do not auto-download, auto-clone, or auto-run remote binaries"*), `openai-firecrawl` will not silently download executables from the internet.
- **Resolution order** (`resolveTunnelClientBinary` in `src/tunnel/process.ts`):
  1. Explicit `TUNNEL_CLIENT_BIN` from `.env` / environment (validated via `existsSync`).
  2. Local `bin/tunnel-client.exe` inside the repository root (convenient drop-in location for Windows users).
  3. `tunnel-client.exe` / `tunnel-client` on the system `PATH` (resolved via `where.exe tunnel-client` on Windows).
- Verification: Execute `<binary> --version` via `runCommand` to confirm the binary is runnable and capture its version string. If missing or not runnable, fail with an actionable error pointing to `https://platform.openai.com/settings/organization/tunnels` and `https://github.com/openai/tunnel-client/releases/latest`.

### 3. Configuration & Secret Handling (`src/config/index.ts`)

Required and optional environment variables in `.env`:

```env
FIRECRAWL_API_URL=http://localhost:3002
FIRECRAWL_HOME=C:/path/to/firecrawl
MCP_PORT=3000

# OpenAI Secure MCP Tunnel
CONTROL_PLANE_TUNNEL_ID=tunnel_0123456789abcdef0123456789abcdef
CONTROL_PLANE_API_KEY=sk-...
# Optional overrides:
# TUNNEL_CLIENT_BIN=C:/path/to/tunnel-client.exe
# TUNNEL_HEALTH_PORT=8080
```

Validation rules in `parseConfig`:
- `tunnelId` (`CONTROL_PLANE_TUNNEL_ID`):
  - Optional during `parseConfig` so `pnpm stop` and `pnpm doctor` can still run and report all checks even before the user finishes tunnel setup.
  - When provided, must match the official `tunnel-client` format regex:
    `^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$`
    (`tunnel_<32 lowercase hex/alphanumeric>` or `tunnel_<4-char-namespace>_<32 lowercase alphanumeric>`).
- `hasTunnelApiKey` (` boolean`):
  - True when `CONTROL_PLANE_API_KEY` or fallback `OPENAI_API_KEY` is non-empty in the environment.
  - **Secret safety**: `AppConfig` only stores `hasTunnelApiKey: boolean` and `tunnelApiKeyEnvVar: "CONTROL_PLANE_API_KEY" | "OPENAI_API_KEY" | undefined`. The raw API key string is never copied into `AppConfig`, state files, CLI arguments, or logs. When spawning `tunnel-client`, the child inherits `process.env` (with `CONTROL_PLANE_API_KEY` set from `OPENAI_API_KEY` if only the fallback was provided).
- `tunnelClientBin` (`TUNNEL_CLIENT_BIN`):
  - Optional non-empty path string.
- `tunnelHealthPort` (`TUNNEL_HEALTH_PORT`):
  - Defaults to `8080` (`tunnel-client`'s default `127.0.0.1:8080`).
  - Validated as an integer between `1` and `65535`, and must not equal `mcpPort`.

### 4. One-Time Manual Setup vs. Automated Runtime Flow

#### One-Time Manual Setup (User in OpenAI Platform & ChatGPT)
1. **Install `tunnel-client.exe`**: Download the Windows release from [Platform Tunnels settings](https://platform.openai.com/settings/organization/tunnels) or [GitHub Releases](https://github.com/openai/tunnel-client/releases/latest) and place `tunnel-client.exe` on `PATH`, in `./bin/tunnel-client.exe`, or set `TUNNEL_CLIENT_BIN` in `.env`.
2. **Create/Select a Tunnel in OpenAI Platform**:
   - In `https://platform.openai.com/settings/organization/tunnels`, create a tunnel (requires Tunnels **Read** + **Manage**).
   - Associate the tunnel with both the Platform organization and the target **ChatGPT workspace**.
   - Copy the `tunnel_id` into `.env` as `CONTROL_PLANE_TUNNEL_ID`.
3. **Create a Runtime API Key**:
   - In `https://platform.openai.com/settings/organization/api-keys`, create a key whose principal has Tunnels **Read** + **Use** permission.
   - Set it in `.env` as `CONTROL_PLANE_API_KEY` (never committed to git).
4. **Connect in ChatGPT (while `pnpm start` is running)**:
   - Open ChatGPT (`https://chatgpt.com/plugins` or `https://chatgpt.com/#settings/Connectors` -> **Add custom MCP server**).
   - Choose **Connection: Tunnel**, select or paste the `tunnel_id`, choose authentication (`No authentication` for local keyless `firecrawl-mcp`), and create the plugin.

#### Automated Runtime Flow (`openai-firecrawl`)
- `pnpm start`:
  1. Ensures self-hosted Firecrawl is running and ready.
  2. Ensures official `firecrawl-mcp` is running and ready at `http://localhost:<MCP_PORT>/mcp`.
  3. Validates tunnel configuration (`CONTROL_PLANE_TUNNEL_ID` and `hasTunnelApiKey`), resolves `tunnel-client.exe`, runs `tunnel-client` attached to `http://localhost:<MCP_PORT>/mcp`, and waits until the local tunnel health server (`http://127.0.0.1:<TUNNEL_HEALTH_PORT>/readyz`) reports HTTP 200 ready.
  4. Prints a clear ready summary including the `tunnel_id`, local MCP URL, local tunnel UI URL (`http://127.0.0.1:<TUNNEL_HEALTH_PORT>/ui`), and brief ChatGPT connection reminder.

### 5. Tunnel Readiness & Loopback Health Probe (`src/tunnel/health.ts`)

`tunnel-client run` binds a loopback-only HTTP server at `127.0.0.1:<TUNNEL_HEALTH_PORT>` exposing:
- `GET /healthz` -> `200 live` when process is up
- `GET /readyz` -> `200 ready...` when startup MCP probe and OAuth discovery succeed; `503` while gated or failing
- `GET /api/status` -> JSON with `control_plane_tunnel_id`, `mcp_server_url`, `version`, `client_instance_id`, etc.
- `GET /health?details=true` -> JSON with `schema_version: 1`, `live: boolean`, `ready: boolean`, and `components`

**Probe classification (`probeTunnelReadiness(healthPort, expectedTunnelId, expectedMcpUrl)`)**:
1. **`ready`**:
   - `GET http://127.0.0.1:<healthPort>/readyz` returns HTTP 200, AND
   - Verification via `GET /api/status` (or `/health?details=true` fallback if running the narrow `tunnel-client-runtime` binary where `/api/status` is absent) confirms it is a `tunnel-client` instance.
   - If `/api/status` is available and returns `control_plane_tunnel_id` or `mcp_server_url` that does **not** match the configured `CONTROL_PLANE_TUNNEL_ID` or `http://localhost:<MCP_PORT>/mcp`, return status **`misconfigured-instance`** so `openai-firecrawl` alerts the user that an existing `tunnel-client` is running for a different tunnel or MCP target.
2. **`starting`** (live but not yet ready):
   - `GET /healthz` returns `200` (and `/api/status` or `/health` confirms `tunnel-client`) while `GET /readyz` returns `503` (e.g. startup probe in progress or MCP/control-plane error).
3. **`port-occupied`**:
   - Port responds to HTTP traffic on `127.0.0.1:<healthPort>`, but responses do not match `tunnel-client` (`/healthz` / `/readyz` / `/api/status` / `/health` signatures).
4. **`unreachable`**:
   - Connection refused / network error on `127.0.0.1:<healthPort>`. Port is free.

### 6. Tunnel Process Spawning, Ownership, and Safe Termination (`src/tunnel/process.ts` & `src/shared/state.ts`)

#### Spawning `tunnel-client` on Windows
- Command & arguments (no secrets in argv):
  ```text
  <tunnelClientBin> run
    --control-plane.tunnel-id <config.tunnelId>
    --mcp.server-url http://localhost:<config.mcpPort>/mcp
    --health.listen-addr 127.0.0.1:<config.tunnelHealthPort>
    --log.level info
  ```
- Environment passed to child:
  - Inherits `process.env`
  - Sets `CONTROL_PLANE_API_KEY` (using `process.env.CONTROL_PLANE_API_KEY || process.env.OPENAI_API_KEY`)
  - Explicitly omits any `--open-web-ui` or `--allow-remote-ui` flags so the admin UI stays strictly loopback-only and headless.
- Spawn options: `detached: true`, `stdio: "ignore"`, `windowsHide: true`, `child.unref()`.

#### Runtime State Schema (`.openai-firecrawl-state.json`)
```ts
export interface TunnelRuntimeState {
  readonly owned: boolean;
  readonly pid?: number | undefined;
  readonly tunnelId: string;
  readonly mcpUrl: string;
  readonly healthPort: number;
  readonly healthUrl: string;
  readonly startedAt?: string | undefined;
}

export interface RuntimeState {
  readonly version: 1;
  readonly updatedAt: string;
  readonly firecrawl?: FirecrawlRuntimeState | undefined;
  readonly mcp?: McpRuntimeState | undefined;
  readonly tunnel?: TunnelRuntimeState | undefined;
}
```

#### Ownership & Lifecycle Rules (`src/tunnel/lifecycle.ts`)
1. **When `pnpm start` runs `ensureTunnelRunning`**:
   - Validate that `config.tunnelId` and `config.hasTunnelApiKey` are present; otherwise throw an actionable `TunnelLifecycleError` explaining which `.env` variable is missing and where to obtain it.
   - Probe `127.0.0.1:<tunnelHealthPort>`:
     - If `port-occupied`: fail immediately with a clear error advising the user to stop the conflicting service or set `TUNNEL_HEALTH_PORT` in `.env`.
     - If `misconfigured-instance`: fail immediately explaining that an active `tunnel-client` on port `<tunnelHealthPort>` is bound to a different `tunnel_id` or `mcp_server_url`.
     - If `ready`:
       - Check `.openai-firecrawl-state.json`. If `state?.tunnel?.owned === true`, `state.tunnel.healthPort === config.tunnelHealthPort`, and `state.tunnel.pid` is alive and verified as `tunnel-client`, preserve `owned: true` and `pid`.
       - Otherwise record `owned: false` (external `tunnel-client` instance) and reuse it without restarting.
     - If `starting`:
       - Wait up to `20_000ms` for `/readyz` to become `ready`. Preserve existing ownership state (`owned: true` only if already owned by this project).
     - If `unreachable`:
       - Resolve `tunnel-client` binary.
       - Optional preflight: run `tunnel-client doctor --json` with `--control-plane.tunnel-id`, `--mcp.server-url`, and `--health.listen-addr` to catch local config/key/listener issues early with structured diagnostics.
       - Spawn detached `tunnel-client run` process.
       - Record `owned: true`, `pid`, `tunnelId`, `mcpUrl`, `healthPort`, `healthUrl`, and `startedAt` in `.openai-firecrawl-state.json`.
       - Poll `waitForTunnelReady` (20s timeout, 500ms interval), also checking if `pid` exited early. If readiness fails, terminate the spawned `pid`, clear `tunnel` state, and throw `TunnelLifecycleError`.
2. **When `pnpm stop` runs (`stopManagedTunnel`)**:
   - Shutdown order: **1. Tunnel -> 2. MCP -> 3. Firecrawl** (stopping the tunnel first ensures no new MCP requests arrive while MCP and Firecrawl are shutting down).
   - If `state?.tunnel?.owned !== true` or `state.tunnel.pid` is undefined, leave the external tunnel process untouched.
   - Verify process identity via `isTunnelProcessAliveAndOwned(pid)`:
     - Check `process.kill(pid, 0)`.
     - On Windows, inspect `Win32_Process` via PowerShell CIM (`Get-CimInstance Win32_Process -Filter "ProcessId = <pid>"`) and confirm `Name` or `CommandLine` contains `tunnel-client`.
   - Terminate verified process with `taskkill /PID <pid> /T /F` (which also terminates any child companion processes) and clear `tunnel` from `.openai-firecrawl-state.json`.
3. **When `pnpm doctor` runs (`runTunnelDoctorChecks`)**:
   - Check 1: **Tunnel Configuration & Credentials** (`CONTROL_PLANE_TUNNEL_ID` format and presence of `CONTROL_PLANE_API_KEY` / `OPENAI_API_KEY` without printing secret values).
   - Check 2: **Tunnel Client Binary** (resolved path and `tunnel-client --version` output, or actionable download instructions if missing).
   - Check 3: **Tunnel Client Preflight (`tunnel-client doctor`) / Health Readiness**:
     - If tunnel is currently running on `TUNNEL_HEALTH_PORT`, report `/readyz`, `/api/status` tunnel ID + MCP URL binding, and `/ui` address.
     - If tunnel is not currently running and binary + config are present, run `tunnel-client doctor --json` (against the local config) and report its preflight result.
   - Check 4: **Tunnel Process Ownership State** (whether managed by `openai-firecrawl`, recorded PID, health URL, and tunnel ID).

---

## Module & File Layout

```text
.env.example                # Add CONTROL_PLANE_TUNNEL_ID, CONTROL_PLANE_API_KEY, optional TUNNEL_CLIENT_BIN, TUNNEL_HEALTH_PORT
src/
  config/
    index.ts                # Extend AppConfig & parseConfig with tunnelId, hasTunnelApiKey, tunnelApiKeyEnvVar, tunnelClientBin, tunnelHealthPort
  shared/
    state.ts                # Add TunnelRuntimeState, updateTunnelState, clearTunnelState
  tunnel/
    health.ts               # probeTunnelReadiness (/readyz, /healthz, /api/status, /health) & waitForTunnelReady
    process.ts              # resolveTunnelClientBinary, runTunnelClientPreflight, spawnTunnelProcess, isTunnelProcessAliveAndOwned, terminateTunnelProcess
    lifecycle.ts            # ensureTunnelRunning, stopManagedTunnel, runTunnelDoctorChecks
    index.ts                # Public exports for src/tunnel
  cli/
    start.ts                # 1. Firecrawl -> 2. MCP -> 3. Secure MCP Tunnel -> Ready summary
    doctor.ts               # Firecrawl + MCP + Tunnel doctor checks
    stop.ts                 # 1. Stop Tunnel -> 2. Stop MCP -> 3. Stop Firecrawl
tests/
  config.test.ts            # Add tests for CONTROL_PLANE_TUNNEL_ID validation, API key presence detection, TUNNEL_HEALTH_PORT validation & port collision
  state.test.ts             # Add tests for tunnel state persistence and independent clearing
  tunnel.test.ts            # Unit tests for tunnel health probe, binary resolution, preflight, lifecycle ownership, and safe stop behavior
```

## Acceptance Criteria

1. Configuration validates `CONTROL_PLANE_TUNNEL_ID` format, `TUNNEL_HEALTH_PORT` range/collision with `MCP_PORT`, and detects `CONTROL_PLANE_API_KEY` / `OPENAI_API_KEY` presence without storing or logging secret values.
2. `pnpm start` brings Firecrawl, `firecrawl-mcp`, and `tunnel-client` to a verified ready state (`GET http://127.0.0.1:<TUNNEL_HEALTH_PORT>/readyz` HTTP 200) pointed at `http://localhost:<MCP_PORT>/mcp`.
3. If a matching `tunnel-client` instance is already running on `TUNNEL_HEALTH_PORT`, `pnpm start` reuses it without restarting and preserves accurate ownership state (`owned: false` for external instances, `owned: true` if started by `openai-firecrawl`).
4. If `TUNNEL_HEALTH_PORT` is occupied by another service or by a `tunnel-client` bound to a different tunnel ID / MCP URL, `pnpm start` and `pnpm doctor` fail with an actionable error without killing the foreign process.
5. `pnpm doctor` reports tunnel config/credential presence, `tunnel-client` binary availability/version, tunnel health/preflight status, and tunnel ownership state without leaking secrets.
6. `pnpm stop` stops managed processes in reverse dependency order (**Tunnel -> MCP -> Firecrawl**), verifies PID identity before terminating `tunnel-client`, and leaves external processes running.
7. `pnpm check`, `pnpm typecheck`, and `pnpm test` pass.
