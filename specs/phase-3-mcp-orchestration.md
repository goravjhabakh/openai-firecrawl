# Phase 3: Official Firecrawl MCP Server Orchestration

## Goal

Add lifecycle management, readiness verification, diagnostics, and conservative Windows process ownership/termination for the official `firecrawl-mcp` server connected to the self-hosted Firecrawl API in Streamable HTTP mode.

## Scope

In scope:
- Add pinned official `firecrawl-mcp` dependency (`3.30.3`) to `package.json`
- Extend persistent runtime state (`src/shared/state.ts`) with `mcp` ownership and process metadata
- Implement `firecrawl-mcp` Streamable HTTP readiness and port-conflict probe (`src/mcp/health.ts`)
- Implement Windows-safe background process spawning, PID identity verification, and termination (`src/mcp/process.ts`)
- Implement MCP lifecycle orchestration (`ensureMcpRunning`, `stopManagedMcp`, `runMcpDoctorChecks`) (`src/mcp/lifecycle.ts`)
- Integrate MCP lifecycle into `pnpm start`, `pnpm doctor`, and `pnpm stop` (stopping MCP before Firecrawl)
- Add Vitest unit tests (`tests/mcp.test.ts` and `tests/state.test.ts`)

Out of scope (future phases):
- ChatGPT tunnel or custom MCP connection setup (Phase 4)
- Custom MCP server implementation or protocol framing beyond standard readiness probing

## Research & Design Decisions

### 1. Official Package, Version Pinning, and Start Command

Based on official `firecrawl/firecrawl-mcp-server` (`firecrawl-mcp@3.30.3`) source inspection (`src/index.ts`, `src/service/profiles.ts`, `src/service/auth.ts`, `src/server.ts`):
- **Version Pinning**: Pin `"firecrawl-mcp": "3.30.3"` in `package.json` `dependencies`.
  - Avoids `npx` cold-start network downloads and surprise breaking changes.
  - Allows resolving `firecrawl-mcp/dist/index.js` directly via `createRequire(import.meta.url).resolve("firecrawl-mcp/dist/index.js")`.
- **Direct Node Execution on Windows**:
  - Spawn `process.execPath` (`node.exe`) directly with `[entryPath]` (`detached: true`, `stdio: "ignore"`, `windowsHide: true`, `child.unref()`).
  - Avoids `.cmd` / `npx` wrapper processes on Windows so the recorded child `pid` is the actual `node.exe` process running `firecrawl-mcp`.
- **Environment Variables**:
  - `HTTP_STREAMABLE_SERVER: "true"` — selects FastMCP `httpStream` transport (`stateless: true`).
  - `PORT: String(config.mcpPort)` — configures the HTTP listen port (reads `process.env.PORT || 3000`).
  - `HOST: "localhost"` — binds locally (default when `CLOUD_SERVICE` is not `"true"`).
  - `FIRECRAWL_API_URL: config.firecrawlApiUrl` — points `firecrawl-mcp` to the self-hosted Firecrawl instance and enables keyless self-hosted HTTP stream mode without requiring `FIRECRAWL_API_KEY`.
  - Optional `FIRECRAWL_API_KEY` from the user's environment is preserved if present, never required or logged.
- **Streamable HTTP Endpoint**:
  - Served at `http://localhost:<MCP_PORT>/mcp`.
  - Built-in HTTP probes on the same port: `GET /ready` (`200 {"ok":true}`) and `GET /health` (`200 ok`).

### 2. MCP Readiness & Port-Conflict Strategy (`src/mcp/health.ts`)

Because `MCP_PORT` defaults to `3000` (commonly used by local dev servers), readiness checks must distinguish between:
1. **`ready`** (`firecrawl-mcp` confirmed):
   - Send a standard MCP `initialize` request via `POST http://localhost:<MCP_PORT>/mcp` with headers:
     - `Content-Type: application/json`
     - `Accept: application/json, text/event-stream`
   - Request body:
     ```json
     {
       "jsonrpc": "2.0",
       "id": 1,
       "method": "initialize",
       "params": {
         "protocolVersion": "2024-11-05",
         "capabilities": {},
         "clientInfo": { "name": "openai-firecrawl-probe", "version": "0.1.0" }
       }
     }
     ```
   - Parse either JSON (`application/json`) or SSE (`text/event-stream` `data:` lines) and verify HTTP 200 with `result.serverInfo.name` containing `"firecrawl"` (officially `"firecrawl-fastmcp"`).
2. **`port-occupied`** (another service is listening on `MCP_PORT`):
   - `POST /mcp` returns any HTTP response that does not carry a valid Firecrawl MCP `initialize` signature (e.g., 404 HTML from Next.js/Express, non-MCP JSON), OR `GET http://localhost:<MCP_PORT>/` returns an HTTP response while `POST /mcp` fails to validate as `firecrawl-mcp`.
   - When `ensureMcpRunning` detects `port-occupied` before spawning, it fails immediately with a clear, actionable `McpLifecycleError` advising the user to stop the conflicting process or change `MCP_PORT` in `.env`, without killing or overwriting anything.
3. **`unreachable`** (nothing listening on `MCP_PORT`):
   - Connection refused / network error on `http://localhost:<MCP_PORT>`. Safe to start a new managed `firecrawl-mcp` process.

### 3. Process Ownership & Safe Windows Termination (`src/mcp/process.ts` & `src/shared/state.ts`)

Extend `.openai-firecrawl-state.json`:
```ts
export interface McpRuntimeState {
  readonly owned: boolean;
  readonly pid?: number | undefined;
  readonly port: number;
  readonly mcpUrl: string;
  readonly firecrawlApiUrl: string;
  readonly startedAt?: string | undefined;
}

export interface RuntimeState {
  readonly version: 1;
  readonly updatedAt: string;
  readonly firecrawl?: FirecrawlRuntimeState | undefined;
  readonly mcp?: McpRuntimeState | undefined;
}
```

**Ownership & Termination Rules**:
1. **Already running when `pnpm start` begins**:
   - If `probeMcpReadiness(config.mcpPort)` returns `status: "ready"`:
     - Check existing state: if `state?.mcp?.owned === true`, `state.mcp.port === config.mcpPort`, and `state.mcp.pid` is still a running `firecrawl-mcp` process, preserve `owned: true` and `pid`.
     - Otherwise, record `owned: false` (no `pid`) so `pnpm stop` leaves the external MCP server untouched.
2. **Started by `openai-firecrawl`**:
   - Spawn detached `node.exe` running `firecrawl-mcp/dist/index.js`.
   - Immediately persist `owned: true`, `pid`, `port`, `mcpUrl`, `firecrawlApiUrl`, and `startedAt`.
   - Poll `waitForMcpReady` (15s timeout, 500ms interval). If readiness fails or the child exits early, clean up the spawned process if still running, clear `mcp` state, and throw `McpLifecycleError`.
3. **Stopping in `pnpm stop`**:
   - Stop MCP **before** stopping Firecrawl.
   - If `state?.mcp?.owned !== true` or `state.mcp.pid` is absent, skip stopping MCP and clear stale `mcp` state if needed.
   - Before terminating `pid`, verify process identity to guard against Windows PID reuse:
     - Check if `pid` is alive (`process.kill(pid, 0)`). If not alive, clear `mcp` state and report `already-stopped`.
     - Verify via PowerShell (`Get-CimInstance Win32_Process -Filter "ProcessId = <pid>"`) that the process command line references `firecrawl-mcp` (or executable is `node` and `probeMcpReadiness(state.mcp.port)` confirms `firecrawl-mcp` is active).
     - If `pid` belongs to an unrelated process (PID reused after exit), do **not** terminate it; clear stale `mcp` state and report safely.
     - Terminate verified process (`taskkill /PID <pid> /T /F` on Windows, with `process.kill(pid)` fallback) and clear `mcp` from runtime state.

## Module & File Layout

```text
package.json              # Add "firecrawl-mcp": "3.30.3"
src/
  shared/
    state.ts              # Add McpRuntimeState, updateMcpState, clearMcpState
  mcp/
    health.ts             # probeMcpReadiness (/mcp initialize check + port conflict detection) & waitForMcpReady
    process.ts            # resolveFirecrawlMcpEntry, spawnMcpProcess, inspectMcpProcess, terminateMcpProcess
    lifecycle.ts          # ensureMcpRunning, stopManagedMcp, runMcpDoctorChecks
    index.ts              # Public exports for src/mcp
  cli/
    start.ts              # Ensure Firecrawl running -> Ensure MCP running -> Print ready summary
    doctor.ts             # Run Firecrawl + MCP doctor checks (package resolution, port/readiness, ownership)
    stop.ts               # Stop managed MCP first, then stop managed Firecrawl
tests/
  state.test.ts           # Add tests for MCP state persistence & partial state clearing
  mcp.test.ts             # Unit tests for MCP probe (ready / port-occupied / unreachable), ownership & stop safety
```

## Acceptance Criteria

1. `pnpm start` ensures Firecrawl is ready, then ensures `firecrawl-mcp` is running in Streamable HTTP mode on `http://localhost:<MCP_PORT>/mcp` connected to `FIRECRAWL_API_URL`.
2. If a valid `firecrawl-mcp` server is already running on `MCP_PORT`, `pnpm start` reuses it without restarting and preserves accurate ownership state.
3. If `MCP_PORT` is occupied by a non-Firecrawl-MCP service, `pnpm start` and `pnpm doctor` detect the port conflict and fail with an actionable error without terminating the foreign process.
4. `pnpm doctor` checks and reports `firecrawl-mcp` package availability, MCP endpoint reachability/readiness (`http://localhost:<MCP_PORT>/mcp`), and MCP process ownership state.
5. `pnpm stop` stops the MCP process before stopping Firecrawl, only terminates an MCP process when `owned === true` and PID identity is verified as `firecrawl-mcp`, and leaves external MCP/Firecrawl instances running.
6. `pnpm check`, `pnpm typecheck`, and `pnpm test` pass, and real integration verification succeeds against local Firecrawl + `firecrawl-mcp` (and MCP Inspector where useful).
