# Phase 2: Self-Hosted Firecrawl Lifecycle Management

## Goal

Implement reliable lifecycle management and diagnostics for the user's existing self-hosted Firecrawl installation on Windows 11, including cross-command ownership tracking so `pnpm stop` only stops a Firecrawl stack that `openai-firecrawl` actually started.

## Scope

In scope:
- Reusable command execution helper (`src/shared/exec.ts`)
- Persistent local runtime state / ownership store (`src/shared/state.ts`)
- Docker CLI and daemon availability checks (`src/firecrawl/docker.ts`)
- Existing Compose project inspection (`src/firecrawl/docker.ts`)
- Firecrawl HTTP reachability and readiness probe (`src/firecrawl/health.ts`)
- `FIRECRAWL_HOME` path and Docker Compose file validation (`src/firecrawl/docker.ts`)
- Firecrawl lifecycle orchestration (`ensureFirecrawlRunning`, `stopManagedFirecrawl`, `runDoctorChecks`) (`src/firecrawl/lifecycle.ts`)
- CLI integration for `pnpm start`, `pnpm doctor`, and `pnpm stop`
- Unit tests for state persistence, health checks, compose inspection, and lifecycle ownership decisions

Out of scope (future phases):
- Starting or managing the official Firecrawl MCP server (Phase 3)
- Starting or managing the ChatGPT tunnel / custom MCP connection (Phase 4)
- Cloning, modifying, or bundling Firecrawl

## Design Decisions

### 1. Firecrawl Readiness Probe

Based on official Firecrawl source code inspection (`apps/api/src/index.ts` and `apps/api/src/routes/v0.ts`):
- Root endpoint `GET /`: Responds with HTTP 200 and JSON body `{ "message": "Firecrawl API", "documentation_url": "https://docs.firecrawl.dev" }`.
- Readiness probe `GET /v0/health/readiness`: Responds with HTTP 200 and JSON body `{ "status": "ok" }`.

**Probe strategy:**
1. Check `GET ${FIRECRAWL_API_URL}/v0/health/readiness` with a short timeout (3000 ms). If it returns HTTP 200 with `{ "status": "ok" }`, the service is healthy and confirmed as Firecrawl.
2. As a fallback check for setups or versions where `/v0/health/readiness` may differ, check `GET ${FIRECRAWL_API_URL}/`. If it returns HTTP 200 with JSON containing `"Firecrawl API"`, the service is confirmed as Firecrawl.
3. If neither Firecrawl-specific indicator is met (e.g. non-200, connection refused, or unexpected payload from an unrelated service on that port), the probe considers Firecrawl not ready / not reachable.
4. Keep the probe isolated in `src/firecrawl/health.ts` so it is easily replaceable.

### 2. Ownership Safety & Compose State Inspection

Before invoking `docker compose up -d`, `openai-firecrawl` inspects the state of containers associated with the configured Firecrawl Compose project (using `docker compose ps --format json` in `FIRECRAWL_HOME`).

**Rules:**
1. If Firecrawl is already responding to the readiness probe:
   - Check existing `.openai-firecrawl-state.json`. If it already recorded `owned: true` (e.g. from a prior `pnpm start` session that was not stopped), preserve `owned: true`.
   - Otherwise, record `owned: false` (external deployment).
2. If Firecrawl is NOT responding to the readiness probe:
   - Inspect existing Compose containers in `FIRECRAWL_HOME`:
     - If any containers for this project already exist (running, restarting, created, or exited):
       - Do **NOT** claim ownership (`owned: false`).
       - Containers belong to an existing deployment that is either still booting, unhealthy, or previously started outside `openai-firecrawl`.
       - If containers are currently running/starting, wait for readiness; if they fail or remain unhealthy, report clear diagnostics without claiming ownership or terminating them.
     - Only if **zero containers** exist for the project:
       - Run `docker compose up -d`.
       - Record `owned: true` in `.openai-firecrawl-state.json`.
       - Poll until readiness is confirmed or bounded timeout (90s) expires.
3. When `pnpm stop` runs:
   - Inspect `.openai-firecrawl-state.json`.
   - Only execute `docker compose down` (without `-v`) if `state?.firecrawl?.owned === true`.
   - If `owned !== true` or state is absent, do not touch Docker and report that Firecrawl was not started by `openai-firecrawl`.

### 3. Local Runtime State Store (`.openai-firecrawl-state.json`)

- Path: `.openai-firecrawl-state.json` (gitignored and ignored by Biome).
- Schema:
  ```ts
  export interface RuntimeState {
    readonly version: 1;
    readonly updatedAt: string;
    readonly firecrawl?: {
      readonly owned: boolean;
      readonly apiUrl: string;
      readonly firecrawlHome?: string;
      readonly startedAt?: string;
    };
  }
  ```

## Repository & Module Layout

```text
src/
  cli/
    start.ts          # Orchestrates config + Firecrawl lifecycle startup
    doctor.ts         # Runs config + Docker + Firecrawl + state diagnostics
    stop.ts           # Stops Firecrawl only if owned by openai-firecrawl
  config/
    index.ts          # Existing Phase 1 config loader
  firecrawl/
    docker.ts         # Docker CLI & daemon availability + compose project inspection
    health.ts         # Firecrawl-specific probe & bounded readiness polling
    lifecycle.ts      # Start/stop/doctor orchestration with injectable deps
    index.ts          # Public exports for src/firecrawl
  shared/
    exec.ts           # Reusable child_process command execution helper
    state.ts          # Read/write/clear .openai-firecrawl-state.json
    index.ts          # Public exports for src/shared
tests/
  config.test.ts      # Existing Phase 1 tests
  state.test.ts       # Unit tests for state file load/save/clear & corrupt handling
  firecrawl.test.ts   # Unit tests for health probes, compose inspection & lifecycle ownership
```

## Acceptance Criteria

1. **Firecrawl already running**: `pnpm start` detects it via Firecrawl-specific probe, does not restart it, records `owned: false` (unless already owned), and exits `0`.
2. **Existing Compose stack booting/stopped**: `pnpm start` detects pre-existing containers, does not claim ownership, and avoids restarting/tearing down existing user stacks.
3. **Firecrawl absent**: `pnpm start` validates `FIRECRAWL_HOME` and Docker, runs `docker compose up -d`, waits until ready (90s timeout, 2s interval), records `owned: true`, and exits `0`.
4. **Invalid/missing `FIRECRAWL_HOME` when startup is needed**: `pnpm start` fails immediately with a clear, actionable error and exits `1`.
5. **Docker unavailable when startup is needed**: `pnpm start` fails immediately with a clear error and exits `1`.
6. **`pnpm run doctor`**: Reports configuration, Docker daemon/compose status, `FIRECRAWL_HOME` validity, Firecrawl API probe status, and ownership status.
7. **`pnpm stop` safety**: Stops Firecrawl via `docker compose down` (without `-v`) only when `.openai-firecrawl-state.json` indicates `owned: true`; leaves external or pre-existing Firecrawl instances running.
8. **Quality checks**: `pnpm check`, `pnpm typecheck`, and `pnpm test` all pass.
