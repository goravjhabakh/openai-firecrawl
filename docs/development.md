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
├── cli/
│   ├── start.ts      # Orchestrates Firecrawl -> MCP -> Tunnel startup
│   ├── doctor.ts     # Runs non-destructive diagnostics across all layers
│   └── stop.ts       # Stops managed Tunnel -> MCP -> Firecrawl safely
├── config/
│   └── index.ts      # .env loader and pure parseConfig validator
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
    ├── state.ts      # .openai-firecrawl-state.json reader/writer
    └── index.ts
```

## Local Setup

```bash
pnpm install
cp .env.example .env
```

Configure `.env` with your local `FIRECRAWL_API_URL`, `FIRECRAWL_HOME`, `MCP_PORT`, `CONTROL_PLANE_TUNNEL_ID`, and `CONTROL_PLANE_API_KEY`. Place `tunnel-client.exe` in `./bin/tunnel-client.exe` or on `PATH`.

## Commands

```bash
# Runtime commands
pnpm start
pnpm run doctor
pnpm stop

# Quality checks
pnpm check
pnpm check:write
pnpm typecheck
pnpm test
```

## Testing Strategy

### Unit Tests (`tests/*.test.ts`)

Deterministic Vitest suites test:

- `tests/config.test.ts` — URL normalization, port validation, port collision detection, tunnel ID regex, and secret-safe API key detection
- `tests/state.test.ts` — `.openai-firecrawl-state.json` persistence and independent layer clearing
- `tests/firecrawl.test.ts` — Firecrawl readiness probes, Compose container inspection, and ownership decisions
- `tests/mcp.test.ts` — MCP JSON-RPC/SSE `initialize` probes, port conflict handling, and PID ownership lifecycle
- `tests/tunnel.test.ts` — `tunnel-client` health probes (`/readyz`, `/api/status`, misconfiguration detection) and lifecycle safety

### Integration Verification

End-to-end verification uses real local services on Windows 11:

1. Self-hosted Firecrawl Docker Compose stack
2. Official `firecrawl-mcp` server (`http://localhost:<MCP_PORT>/mcp`)
3. Official `tunnel-client.exe` (`http://127.0.0.1:<TUNNEL_HEALTH_PORT>/readyz`)
4. ChatGPT custom MCP server connection (`Connection: Tunnel`)
