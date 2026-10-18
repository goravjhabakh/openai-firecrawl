# Architecture

## Overview

```text
+--------------------------------------------------+
|                     ChatGPT                      |
|      (Custom MCP Server, Connection: Tunnel)     |
+-------------------------+------------------------+
                          |
                          | MCP over OpenAI Control Plane
                          v
+--------------------------------------------------+
|              OpenAI Tunnel Service               |
|    https://api.openai.com/v1/tunnels/<id>/*      |
+-------------------------+------------------------+
                          ^
                          | Outbound-only HTTPS long-poll
                          | (CONTROL_PLANE_API_KEY)
                          |
+-------------------------+------------------------+
|               tunnel-client.exe                  |
|   Loopback Health/UI: 127.0.0.1:<HEALTH_PORT>    |
+-------------------------+------------------------+
                          |
                          | Streamable HTTP MCP
                          v
+--------------------------------------------------+
|             Official firecrawl-mcp               |
|          http://localhost:<MCP_PORT>/mcp         |
+-------------------------+------------------------+
                          |
                          | FIRECRAWL_API_URL
                          v
+--------------------------------------------------+
|              Self-hosted Firecrawl               |
|              http://localhost:3002               |
+-------------------------+------------------------+
                          |
                          v
                         Web
```

## Component Responsibilities

### ChatGPT

Acts as the MCP client and invokes Firecrawl tools (`firecrawl_scrape`, `firecrawl_search`, `firecrawl_map`, `firecrawl_crawl`, etc.) through the configured Tunnel connector.

### OpenAI Secure MCP Tunnel (`tunnel-client`)

Establishes an outbound-only HTTPS long-polling connection from the developer machine to `https://api.openai.com`, receives MCP JSON-RPC requests for `CONTROL_PLANE_TUNNEL_ID`, and forwards them to `http://localhost:<MCP_PORT>/mcp`.

- Exposes a loopback-only health and admin server at `http://127.0.0.1:<TUNNEL_HEALTH_PORT>` (`/healthz`, `/readyz`, `/health?details=true`, `/api/status`, `/ui`).
- Started without `--allow-remote-ui` so the admin interface remains strictly local.
- On Windows, `openai-firecrawl` sets `TUNNEL_CLIENT_CODEX_APP_SERVER_CMD=disabled` when spawning `tunnel-client` in the background so its internal Codex bridge does not open an interactive console window.

### Official Firecrawl MCP Server (`firecrawl-mcp`)

Pinned as a local dependency (`firecrawl-mcp@3.30.3`) and spawned directly via `node.exe` in Streamable HTTP mode (`HTTP_STREAMABLE_SERVER=true`, `HOST=localhost`, `PORT=<MCP_PORT>`) pointed at `FIRECRAWL_API_URL`.

### Self-hosted Firecrawl

Performs scraping, search, mapping, and crawling inside the user's existing Docker Compose stack (`FIRECRAWL_HOME`).

### `openai-firecrawl`

Coordinates configuration, health probes, process spawning, diagnostics, and conservative teardown across the three local layers:

- `src/config/` — `.env` loading and validation (`ConfigError`)
- `src/firecrawl/` — Docker/Compose inspection, `/v0/health/readiness` probing, and Compose lifecycle
- `src/mcp/` — `firecrawl-mcp` resolution, Streamable HTTP MCP `initialize` probing, and Node child lifecycle
- `src/tunnel/` — `tunnel-client` binary resolution, `/readyz` + `/api/status` probing, and tunnel child lifecycle
- `src/shared/` — `execFile` wrapper and `.openai-firecrawl-state.json` persistence
- `src/cli/` — `start.ts`, `doctor.ts`, and `stop.ts` entrypoints

## Process Ownership & Teardown Safety

Ownership is persisted in `.openai-firecrawl-state.json`:

- **Startup order:** `1. Firecrawl` → `2. firecrawl-mcp` → `3. tunnel-client`
- **Shutdown order (`pnpm stop`):** `1. tunnel-client` → `2. firecrawl-mcp` → `3. Firecrawl`
- If any component is already running when `pnpm start` executes (or if Firecrawl Compose containers already exist in `FIRECRAWL_HOME`), `openai-firecrawl` records `owned: false` and reuses it.
- During `pnpm stop`, only components with `owned: true` are stopped. For `firecrawl-mcp` and `tunnel-client`, Windows process identity is verified against `Win32_Process` (`Name` and `CommandLine`) before running `taskkill /PID <pid> /T /F` to guard against PID reuse.
