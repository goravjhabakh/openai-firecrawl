# Project

## Problem

Developers can self-host Firecrawl locally, but ChatGPT's standard web integrations do not natively talk to a local Firecrawl server.

`openai-firecrawl` provides a lightweight local orchestration layer on Windows 11 so ChatGPT can use a developer's self-hosted Firecrawl instance through the official Firecrawl MCP server and OpenAI Secure MCP Tunnel.

## Target users

- Developers already self-hosting Firecrawl with Docker Compose
- ChatGPT users who want their local Firecrawl instance connected as a custom MCP server without consuming Firecrawl Cloud credits or opening inbound firewall ports

## V1 scope

`openai-firecrawl` handles:

- reading and validating local configuration from `.env`
- checking Docker CLI, daemon, and Compose availability
- probing whether the configured Firecrawl API (`FIRECRAWL_API_URL`) is reachable and ready
- starting the user's existing Firecrawl Docker Compose stack (`FIRECRAWL_HOME`) when needed
- starting and verifying the official `firecrawl-mcp` server in Streamable HTTP mode (`http://localhost:<MCP_PORT>/mcp`)
- starting and verifying the official OpenAI Secure MCP Tunnel (`tunnel-client`) connected to the local MCP endpoint
- tracking process ownership in `.openai-firecrawl-state.json` so `pnpm stop` never stops pre-existing user services
- providing `pnpm start`, `pnpm run doctor`, and `pnpm stop` commands with actionable diagnostics

Verified Firecrawl capabilities over MCP:

- `firecrawl_scrape`
- `firecrawl_search`
- `firecrawl_map`
- `firecrawl_crawl` / `firecrawl_check_crawl_status`

## Non-goals

V1 does not:

- reimplement Firecrawl or the MCP protocol
- redistribute or fork the Firecrawl Docker stack
- auto-download remote binaries from the internet
- expose public inbound tunnels (`ngrok`, `cloudflared`, port forwarding)
- provide a custom web UI
- guarantee macOS or Linux support prior to Windows V1 stability

## Configuration

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

- `FIRECRAWL_HOME` points to an existing Firecrawl checkout and is used when `openai-firecrawl` needs to start its Docker Compose stack.
- No Firecrawl Cloud API key is required for the self-hosted path.
- `CONTROL_PLANE_API_KEY` (or fallback `OPENAI_API_KEY`) authenticates `tunnel-client` against the OpenAI control plane and is never logged or persisted to state files.

## Commands

### `pnpm start`

Brings the local integration to a verified ready state:

1. Validates `.env` configuration.
2. Probes Firecrawl readiness; starts the Compose stack in `FIRECRAWL_HOME` if needed and waits for readiness.
3. Starts or reuses `firecrawl-mcp` on `http://localhost:<MCP_PORT>/mcp` and verifies MCP initialization.
4. Starts or reuses `tunnel-client` on `http://127.0.0.1:<TUNNEL_HEALTH_PORT>` and waits for `/readyz` HTTP 200.
5. Prints the ready summary and ChatGPT connection steps.

### `pnpm run doctor`

Runs non-destructive checks across configuration, Docker, Firecrawl, `firecrawl-mcp`, `tunnel-client`, and ownership state.

### `pnpm stop`

Stops managed processes in reverse dependency order (**Tunnel → MCP → Firecrawl**). Any service that was already running before `pnpm start` (`owned: false`) is left untouched.
