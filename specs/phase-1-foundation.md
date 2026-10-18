# Phase 1: Project Foundation

## Goal

Establish the TypeScript, pnpm, Biome, Vitest, configuration, CLI skeleton, and CI foundation for `openai-firecrawl`.

## Scope

In scope:
- `package.json` and `pnpm` configuration
- `.gitignore` and `.env.example`
- TypeScript strict configuration (`tsconfig.json`)
- Biome formatting and linting configuration (`biome.json`)
- Vitest test runner setup (`vitest.config.ts`)
- Initial `src/` module structure
- Environment configuration loading and validation (`src/config/`)
- CLI entrypoints for `start`, `doctor`, and `stop` (`src/cli/`)
- Unit tests for configuration validation
- GitHub Actions CI workflow (`.github/workflows/ci.yml`)

Out of scope (future phases):
- Docker or Firecrawl lifecycle checks and orchestration
- Official Firecrawl MCP process management
- Tunnel / ChatGPT connection management
- Process ownership persistence

## Repository Layout

```text
.github/
  workflows/
    ci.yml
specs/
  phase-1-foundation.md
src/
  cli/
    start.ts
    doctor.ts
    stop.ts
  config/
    index.ts
  firecrawl/
    index.ts
  mcp/
    index.ts
  tunnel/
    index.ts
  shared/
    index.ts
tests/
  config.test.ts
.env.example
.gitignore
biome.json
package.json
tsconfig.json
vitest.config.ts
```

## Requirements

### 1. Package & Tooling (`package.json`)

- `"type": "module"`
- `"private": true`
- `"engines"`: `{ "node": ">=22.0.0" }` (supports built-in `process.loadEnvFile` / modern Node APIs)
- `"packageManager"`: pinned current `pnpm` version
- Scripts:
  - `start`: `tsx src/cli/start.ts`
  - `doctor`: `tsx src/cli/doctor.ts`
  - `stop`: `tsx src/cli/stop.ts`
  - `check`: `biome check .`
  - `check:write`: `biome check --write .`
  - `typecheck`: `tsc --noEmit`
  - `test`: `vitest run`
- Dev dependencies only (no runtime framework dependencies needed yet):
  - `typescript`
  - `@types/node`
  - `tsx`
  - `@biomejs/biome`
  - `vitest`

### 2. TypeScript (`tsconfig.json`)

- Target modern Node (`ES2023` / `NodeNext` module resolution)
- Strict mode enabled (`strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`)
- `noEmit: true`
- Include `src/**/*.ts` and `tests/**/*.ts`

### 3. Biome (`biome.json`)

- Enable formatter and linter
- Organize imports enabled
- Ignore `node_modules`, `dist`, `coverage`, `.env`

### 4. Configuration (`src/config/index.ts` & `.env.example`)

`.env.example`:
```env
FIRECRAWL_API_URL=http://localhost:3002
FIRECRAWL_HOME=C:/path/to/firecrawl
MCP_PORT=3000
```

`src/config/index.ts`:
- Load `.env` if present (using Node's built-in `process.loadEnvFile` when `.env` exists)
- Export `AppConfig` type:
  - `firecrawlApiUrl: string` (default `http://localhost:3002`, must be a valid `http:` or `https:` URL, normalized without trailing slash)
  - `firecrawlHome: string | undefined` (optional non-empty path string; path existence will be checked in lifecycle/doctor phases when needed)
  - `mcpPort: number` (default `3000`, integer between `1` and `65535`)
- Export `parseConfig(env: NodeJS.ProcessEnv): AppConfig` for pure, deterministic unit testing
- Export `loadConfig(): AppConfig` for CLI usage
- Throw clear, actionable `ConfigError` messages when validation fails without leaking sensitive values

### 5. CLI Entrypoints (`src/cli/`)

- `src/cli/start.ts`: loads and validates config, prints foundation status summary (configured Firecrawl URL, MCP port, and whether `FIRECRAWL_HOME` is set), and exits cleanly with code `0` (or prints actionable error and exits with code `1` on invalid config).
- `src/cli/doctor.ts`: validates config and reports configuration check status as the initial diagnostic check; exits `0` on valid config, `1` on invalid config.
- `src/cli/stop.ts`: prints foundation placeholder message (`No managed processes to stop (foundation phase).`) and exits `0`.

### 6. Placeholder Module Boundaries

Create minimal module entrypoints (`src/firecrawl/index.ts`, `src/mcp/index.ts`, `src/tunnel/index.ts`, `src/shared/index.ts`) so the planned layout in `docs/development.md` exists and passes strict typechecking.

### 7. Unit Tests (`tests/config.test.ts`)

Test `parseConfig` with Vitest:
- applies defaults when optional/defaulted variables are omitted
- parses valid `FIRECRAWL_API_URL`, `FIRECRAWL_HOME`, and `MCP_PORT`
- normalizes trailing slash on `FIRECRAWL_API_URL`
- rejects invalid `FIRECRAWL_API_URL` (malformed URL or non-http/https protocol)
- rejects invalid `MCP_PORT` (non-numeric, out of range `1-65535`, non-integer)

### 8. GitHub CI (`.github/workflows/ci.yml`)

Run on `push` to `main` and `pull_request`:
- Setup Node.js (v22) and `pnpm`
- `pnpm install --frozen-lockfile`
- `pnpm check`
- `pnpm typecheck`
- `pnpm test`

## Acceptance Criteria

1. `pnpm install` succeeds cleanly.
2. `pnpm check` passes with zero Biome errors.
3. `pnpm typecheck` passes with strict TypeScript.
4. `pnpm test` passes all unit tests.
5. `pnpm start`, `pnpm doctor`, and `pnpm stop` execute cleanly.
