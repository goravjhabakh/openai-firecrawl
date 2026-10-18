# Development

## Stack

- Node.js (`>= 22.0.0`)
- TypeScript (strict mode, `NodeNext`)
- pnpm
- Biome (formatting & linting)
- Vitest (unit testing)

## Source Layout

```text
src/
├── cli.ts            # Unified CLI entrypoint (#!/usr/bin/env node) & argument parser
├── cli/
│   ├── init.ts       # Bootstraps %APPDATA%\openai-firecrawl\.env safely
│   ├── start.ts      # Orchestrates Firecrawl -> MCP -> Tunnel startup
│   ├── doctor.ts     # Runs non-destructive diagnostics across all layers
│   └── stop.ts       # Stops managed Tunnel -> MCP -> Firecrawl safely
├── config/
│   └── index.ts      # User-level .env loader and pure parseConfig validator
├── firecrawl/
│   ├── docker.ts     # Docker CLI/daemon checks and Compose inspection
│   ├── health.ts     # Firecrawl HTTP readiness probes and polling
│   ├── lifecycle.ts  # ensureFirecrawlRunning, stopManagedFirecrawl, runDoctorChecks
│   └── index.ts
├── mcp/
│   ├── health.ts     # Streamable HTTP MCP initialize probe & port conflict check
│   ├── process.ts    # firecrawl-mcp resolution, detached spawn, CIM PID check
│   ├── lifecycle.ts  # ensureMcpRunning, stopManagedMcp, runMcpDoctorChecks
│   └── index.ts
├── tunnel/
│   ├── health.ts     # Loopback /readyz, /healthz, /api/status, /health probes
│   ├── process.ts    # tunnel-client binary resolution, preflight, detached spawn, CIM PID check
│   ├── lifecycle.ts  # ensureTunnelRunning, stopManagedTunnel, runTunnelDoctorChecks
│   └── index.ts
└── shared/
    ├── exec.ts       # Promise-based execFile command runner
    ├── state.ts      # %LOCALAPPDATA%\openai-firecrawl\state.json reader/writer
    └── index.ts
```

## Local Setup

```bash
pnpm install
pnpm run init
```

Configure `%APPDATA%\openai-firecrawl\.env` with your local `FIRECRAWL_API_URL`, `FIRECRAWL_HOME`, `MCP_PORT`, `CONTROL_PLANE_TUNNEL_ID`, and `CONTROL_PLANE_API_KEY`. Place `tunnel-client.exe` on `PATH`, at `%LOCALAPPDATA%\openai-firecrawl\bin\tunnel-client.exe`, or set `TUNNEL_CLIENT_BIN`.

## Commands

```bash
# Development CLI commands (via tsx)
pnpm run init
pnpm start
pnpm run doctor
pnpm stop

# Build & quality checks
pnpm build
pnpm check
pnpm check:write
pnpm typecheck
pnpm test
```

*(Note: Always use `pnpm run init` and `pnpm run doctor` rather than `pnpm init` or `pnpm doctor`, which are built-in `pnpm` commands.)*

## Testing Strategy

### Unit Tests (`tests/*.test.ts`)

Deterministic Vitest suites test:

- `tests/cli.test.ts` — CLI argument parsing (`init`, `start`, `doctor`, `stop`, `--version`, `--help`), `init` file creation and non-overwrite behavior, CWD-independent `firecrawl-mcp` resolution, and compiled `dist/cli.js` execution
- `tests/config.test.ts` — URL normalization, port validation, port collision detection, tunnel ID regex, secret-safe API key detection, `%APPDATA%` path resolution, and `process.env` > `.env` > defaults precedence
- `tests/state.test.ts` — `%LOCALAPPDATA%\openai-firecrawl\state.json` persistence, automatic directory creation, and independent layer clearing
- `tests/firecrawl.test.ts` — Firecrawl readiness probes, Compose container inspection, and ownership decisions
- `tests/mcp.test.ts` — MCP JSON-RPC/SSE `initialize` probes, port conflict handling, and PID ownership lifecycle
- `tests/tunnel.test.ts` — `tunnel-client` health probes (`/readyz`, `/api/status`, misconfiguration detection), `%LOCALAPPDATA%\openai-firecrawl\bin\tunnel-client.exe` binary resolution, and lifecycle safety

### Packaging & Integration Verification

End-to-end verification on Windows 11 tests both local services and global packaging:

1. Build and pack with `pnpm build` and `npm pack`
2. Install globally with `npm install -g ./goravjhabakh-openai-firecrawl-1.1.0.tgz`
3. Verify `openai-firecrawl --version`, `--help`, `init`, `doctor`, `start`, and `stop` from a working directory outside the repository
