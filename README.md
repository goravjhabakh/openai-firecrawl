# openai-firecrawl

Connect ChatGPT to an existing self-hosted [Firecrawl](https://github.com/mendableai/firecrawl) instance through the official [Firecrawl MCP server](https://github.com/firecrawl/firecrawl-mcp-server) and [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

`openai-firecrawl` is a small, conservative local orchestrator. It does not reimplement Firecrawl or MCP, requires no Firecrawl Cloud API key for self-hosted instances, and never exposes public inbound ports on your machine.

## Architecture

```text
ChatGPT (Custom MCP Server, Connection: Tunnel)
  │
  ▼
OpenAI Tunnel Service (https://api.openai.com/v1/tunnels/<tunnel_id>/*)
  ▲
  │ Outbound-only HTTPS long-poll (authenticated via CONTROL_PLANE_API_KEY)
  │
tunnel-client.exe (local background process)
  ├─ Loopback Health & Admin UI: http://127.0.0.1:<TUNNEL_HEALTH_PORT> (/readyz, /ui)
  │
  ▼ Local Streamable HTTP MCP
Official firecrawl-mcp (http://localhost:<MCP_PORT>/mcp)
  │
  ▼ Local HTTP API (FIRECRAWL_API_URL)
Self-hosted Firecrawl (http://localhost:3002)
```

## Supported Environment

- **OS:** Windows 11 (V1 target platform)
- **Node.js:** `>= 22.0.0`
- **Docker:** Docker Desktop with Docker Compose v2

## Prerequisites

1. **Self-hosted Firecrawl:** An existing local Firecrawl checkout configured with Docker Compose (running or ready to start). See the [official Firecrawl self-hosting guide](https://docs.firecrawl.dev/contributing/self-host) if you have not set it up yet.
2. **OpenAI Secure MCP Tunnel (`tunnel-client.exe`):**
   - Download `tunnel-client-vX.Y.Z-windows-amd64.zip` from [OpenAI Platform Tunnels settings](https://platform.openai.com/settings/organization/tunnels) or [GitHub Releases](https://github.com/openai/tunnel-client/releases/latest).
   - Place `tunnel-client.exe` on your system `PATH`, in `%LOCALAPPDATA%\openai-firecrawl\bin\tunnel-client.exe`, or point `TUNNEL_CLIENT_BIN` to it in `%APPDATA%\openai-firecrawl\.env`.
3. **ChatGPT & OpenAI Platform access:** Support for custom MCP servers and OpenAI Secure MCP Tunnels.

## Installation

Install the global CLI via npm:

```bash
npm install -g @goravjhabakh/openai-firecrawl
```

Quick start:

```bash
openai-firecrawl init
openai-firecrawl doctor
openai-firecrawl start
openai-firecrawl stop
```

## Upgrading from `v1.0.0` to `v1.1.0`

In `v1.1.0`, configuration and runtime ownership state moved from repository-local files to user-level Windows directories so the CLI works from any working directory:

- **Config:** `<repo>/.env` → `%APPDATA%\openai-firecrawl\.env`
- **State:** `<repo>/.openai-firecrawl-state.json` → `%LOCALAPPDATA%\openai-firecrawl\state.json`

If you currently have a stack running under `v1.0.0`:

1. Run `pnpm stop` in your `v1.0.0` repository checkout **before** upgrading so your previously managed processes are stopped cleanly using the old repo-local state file.
2. Install or upgrade to `v1.1.0` (`npm install -g @goravjhabakh/openai-firecrawl`).
3. Run `openai-firecrawl init` and copy your existing settings from `<repo>/.env` into `%APPDATA%\openai-firecrawl\.env`.

## OpenAI Tunnel Setup

Before running `openai-firecrawl start` for the first time:

1. **Create a Tunnel in OpenAI Platform:**
   - Open [Platform Settings → Tunnels](https://platform.openai.com/settings/organization/tunnels).
   - Create a tunnel (requires Tunnels **Read** + **Manage** permissions) and link it to your target **ChatGPT workspace**.
   - Copy the `tunnel_id` (e.g., `tunnel_0123456789abcdef0123456789abcdef`).
2. **Create a Runtime API Key:**
   - Open [Platform Settings → API Keys](https://platform.openai.com/settings/organization/api-keys).
   - Create an API key with Tunnels **Read** + **Use** permissions.

## Configuration (`%APPDATA%\openai-firecrawl\.env`)

Initialize your user configuration file:

```bash
openai-firecrawl init
```

This creates `%APPDATA%\openai-firecrawl\.env` (if it does not already exist):

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

Configuration precedence is:

```text
process environment
        ↓
%APPDATA%\openai-firecrawl\.env
        ↓
defaults
```

- `FIRECRAWL_HOME` is used to run `docker compose up -d` when Firecrawl is not already running. If you manage Firecrawl externally and it is already running at `FIRECRAWL_API_URL`, `FIRECRAWL_HOME` is optional.
- No `FIRECRAWL_API_KEY` is needed for self-hosted Firecrawl.

## CLI Commands

### `openai-firecrawl init`

Creates `%APPDATA%\openai-firecrawl\.env` with a safe template if missing. Never overwrites an existing configuration file.

### `openai-firecrawl start`

Brings the full local stack to a verified ready state:

1. Loads and validates configuration (`process.env` > `%APPDATA%\openai-firecrawl\.env` > defaults).
2. Checks whether Firecrawl is already reachable at `FIRECRAWL_API_URL`; if not, verifies Docker and `FIRECRAWL_HOME` and starts the Firecrawl Docker Compose stack (`docker compose up -d`).
3. Starts (or reuses) the official `firecrawl-mcp` server in Streamable HTTP mode at `http://localhost:<MCP_PORT>/mcp`.
4. Starts (or reuses) `tunnel-client` connected to `http://localhost:<MCP_PORT>/mcp` and waits until `http://127.0.0.1:<TUNNEL_HEALTH_PORT>/readyz` reports ready.
5. Records process ownership in `%LOCALAPPDATA%\openai-firecrawl\state.json` and prints your ChatGPT connection details.

### `openai-firecrawl doctor`

Runs non-destructive diagnostics across your setup:

- Configuration file & port validation
- Docker daemon & Compose availability
- `FIRECRAWL_HOME` & Compose container status
- Firecrawl API readiness probe
- `firecrawl-mcp` package resolution & MCP endpoint status
- OpenAI tunnel credentials presence, `tunnel-client` binary resolution, and health/preflight status
- Process ownership state

### `openai-firecrawl stop`

Safely stops services in reverse dependency order (**Tunnel → MCP → Firecrawl**):

- Only stops services that `openai-firecrawl` actually started (`owned: true` in `%LOCALAPPDATA%\openai-firecrawl\state.json`).
- Verifies Windows process identity (PID + command-line inspection via `Win32_Process`) before terminating `tunnel-client` or `firecrawl-mcp`.
- Leaves any pre-existing external Firecrawl, MCP, or tunnel instances untouched.

### `openai-firecrawl --version` / `openai-firecrawl --help`

Prints the installed package version or command usage and configured file paths.

*(For local repository development, `pnpm run init`, `pnpm start`, `pnpm run doctor`, and `pnpm stop` route through the same CLI implementation.)*

## ChatGPT Custom MCP Setup

Once `openai-firecrawl start` reports `SUCCESS`:

1. Open ChatGPT and navigate to **Settings → Connectors** (or **Plugins**) → **Add custom MCP server**.
2. Set **Connection** to **Tunnel**.
3. Select or paste your `CONTROL_PLANE_TUNNEL_ID`.
4. Set **Authentication** to **No authentication** (your local `firecrawl-mcp` runs in keyless self-hosted mode over the private tunnel).
5. Save/Create the connector.

## Example Usage in ChatGPT

With the connector enabled in a ChatGPT conversation, try prompts such as:

- **Scrape:** *"Use Firecrawl to scrape `https://example.com` in markdown format and summarize the content."*
- **Search:** *"Use Firecrawl to search the web for the latest Node.js LTS release notes."*
- **Map:** *"Use Firecrawl to map the URLs on `https://docs.firecrawl.dev`."*
- **Crawl:** *"Use Firecrawl to crawl `https://example.com` with a limit of 3 pages and check the crawl status."*

You can monitor live tunnel state locally at `http://127.0.0.1:8080/ui` (or your configured `TUNNEL_HEALTH_PORT`).

## Current Limitations

- **Windows-first (V1):** Process inspection and background spawning are built and tested specifically for Windows 11.
- **User-managed prerequisites:** This project does not install or configure the self-hosted Firecrawl Docker stack or auto-download `tunnel-client.exe`.
- **Single user-level stack:** Runtime ownership state is tracked per user in `%LOCALAPPDATA%\openai-firecrawl\state.json`.

## Documentation & Troubleshooting

- [Troubleshooting Guide](docs/troubleshooting.md) — solutions for Docker, Firecrawl readiness, port conflicts, `tunnel-client`, and ChatGPT connection issues
- [Project Scope](docs/project.md)
- [Architecture](docs/architecture.md)
- [Development Guide](docs/development.md)

## License

[MIT](LICENSE)
