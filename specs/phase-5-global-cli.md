# Phase 5: Global npm CLI (`v1.1.0`)

## Goal

Publish `openai-firecrawl` as a globally installable npm CLI package (`@goravjhabakh/openai-firecrawl` at `v1.1.0`) so Windows 11 users can install and run `openai-firecrawl init | doctor | start | stop` from any working directory without cloning the repository or relying on `tsx`.

## Scope

In scope:
- Publishable npm package configuration (`@goravjhabakh/openai-firecrawl`, `version: "1.1.0"`, `bin`, `files`, `prepack`, `build`)
- Production TypeScript build (`tsconfig.build.json` compiling `src/` to `dist/` with Node shebang in `dist/cli.js`)
- Unified CLI dispatcher (`src/cli.ts`) supporting `init`, `start`, `doctor`, `stop`, `--version` (`-v`), and `--help` (`-h`)
- User-level Windows configuration at `%APPDATA%\openai-firecrawl\.env` with `process.env` > global `.env` > defaults precedence
- User-level Windows runtime ownership state at `%LOCALAPPDATA%\openai-firecrawl\state.json`
- Non-destructive `openai-firecrawl init` command to bootstrap the user config file
- Updated `firecrawl-mcp` package resolution relative to the installed package root (`import.meta.url`) rather than `process.cwd()`
- Updated `tunnel-client.exe` binary resolution strategy suitable for global CLI usage
- Preserved repo-local development commands (`pnpm start`, `pnpm run doctor`, `pnpm stop`) routed through the unified CLI
- Unit and compiled-CLI tests (`tests/cli.test.ts`, plus updates to `tests/config.test.ts`, `tests/state.test.ts`, and `tests/tunnel.test.ts`)
- Local packaging verification via `npm pack` and global tarball installation outside the repository

Out of scope:
- Publishing to the npm registry (will be done after approval and verification)
- Retagging or modifying `v1.0.0`
- Bundling or auto-downloading `tunnel-client.exe`
- Cross-platform (macOS/Linux) process management changes
- Automated migration tools for old repo-local `.env` or `.openai-firecrawl-state.json` files

---

## Design Decisions

### 1. Publishable Package & Build Strategy (`package.json` & `tsconfig.build.json`)

- **Package identity**:
  - `"name": "@goravjhabakh/openai-firecrawl"`
  - `"version": "1.1.0"`
  - Remove `"private": true`
  - Add `"publishConfig": { "access": "public" }` so scoped publishing defaults to public access when ready
- **Executable entrypoint**:
  - `"bin": { "openai-firecrawl": "./dist/cli.js" }`
  - `src/cli.ts` starts with `#!/usr/bin/env node` so npm generates the global Windows shims (`openai-firecrawl.cmd`, `openai-firecrawl.ps1`, `openai-firecrawl`) pointing to `dist/cli.js` executed by `node` (no `tsx` runtime dependency).
- **Build configuration**:
  - Keep `tsconfig.json` (`noEmit: true`) covering `src/**/*.ts`, `tests/**/*.ts`, and `vitest.config.ts` for IDE and `pnpm typecheck`.
  - Add `tsconfig.build.json` extending `tsconfig.json` with:
    - `"noEmit": false`
    - `"rootDir": "src"`
    - `"outDir": "dist"`
    - `"declaration": true`
    - `"include": ["src/**/*.ts"]`
  - Add scripts to `package.json`:
    - `"build": "tsc -p tsconfig.build.json"`
    - `"prepack": "pnpm run build"`
    - `"start": "tsx src/cli.ts start"`
    - `"doctor": "tsx src/cli.ts doctor"`
    - `"stop": "tsx src/cli.ts stop"`
- **Published files whitelist**:
  - `"files": ["dist", "README.md", "LICENSE"]`
  - Excludes `src/`, `tests/`, `specs/`, `docs/`, `bin/`, `.github/`, and local config/state files from the published tarball.

### 2. Unified CLI Architecture (`src/cli.ts` & `src/cli/*.ts`)

- **Entrypoint (`src/cli.ts`)**:
  - Uses a small, zero-dependency custom argument parser (`parseCliArgs(argv: readonly string[])`).
  - Supported commands and flags:
    - `openai-firecrawl init`
    - `openai-firecrawl start`
    - `openai-firecrawl doctor`
    - `openai-firecrawl stop`
    - `openai-firecrawl --version` / `-v`
    - `openai-firecrawl --help` / `-h` (also shown when invoked with no arguments: `openai-firecrawl` -> prints help and exits `0`)
  - Unknown commands or unexpected flags print an actionable error message and usage summary to `stderr` and exit with code `1`.
- **Reusable command modules (`src/cli/`)**:
  - Refactor `src/cli/start.ts`, `src/cli/doctor.ts`, and `src/cli/stop.ts` to export `runStartCommand()`, `runDoctorCommand()`, and `runStopCommand()` instead of executing `void main()` as top-level side effects on import.
  - Add `src/cli/init.ts` exporting `runInitCommand()`.
  - `src/cli.ts` dispatches to these functions and handles exit codes cleanly.

### 3. Global Configuration (`src/config/index.ts`)

- **Canonical Windows path**:
  ```text
  %APPDATA%\openai-firecrawl\.env
  ```
  - Resolved via `getDefaultConfigDir()` / `getDefaultConfigFilePath()`:
    - Uses `process.env.APPDATA` when set, falling back to ` path.join(os.homedir(), "AppData", "Roaming")` on Windows, and joins `"openai-firecrawl"`, `".env"`.
  - **Why `%APPDATA%` (`AppData\Roaming`)**: Standard Windows convention for user-edited application configuration files.
- **Configuration precedence**:
  ```text
  process environment (process.env)
          ↓
  global config file (%APPDATA%\openai-firecrawl\.env)
          ↓
  defaults
  ```
  - Node's built-in `process.loadEnvFile(envPath)` loads key-value pairs from `envPath` into `process.env` **without** overwriting variables that are already present in `process.env`, naturally satisfying `process.env` > global `.env` > defaults.
  - For deterministic unit testing without mutating global `process.env`, also support parsing `.env` content via `node:util` `parseEnv` (built into Node >= 20.12 / 22) merged beneath explicit `env` overrides (`{ ...parsedFileEnv, ...processEnv }`).
- **Diagnostics**:
  - `loadConfig` and `doctor` report the resolved global config file path (`%APPDATA%\openai-firecrawl\.env`) and whether the file exists, so the user always knows where configuration is read from.
  - Error messages that previously said `"in .env"` will reference the global config path or `"run 'openai-firecrawl init'"`.

### 4. Global Runtime Ownership State (`src/shared/state.ts`)

- **Canonical Windows path**:
  ```text
  %LOCALAPPDATA%\openai-firecrawl\state.json
  ```
  - Resolved via `getDefaultStateDir()` / `getDefaultStateFilePath()`:
    - Uses `process.env.LOCALAPPDATA` when set, falling back to `path.join(os.homedir(), "AppData", "Local")` on Windows, and joins `"openai-firecrawl"`, `"state.json"`.
  - **Why `%LOCALAPPDATA%` (`AppData\Local`)**: Standard Windows convention for machine-specific, transient runtime state (PIDs, local ports, timestamps) that should never roam across machines or depend on the current working directory.
- **Directory creation**:
  - `writeRuntimeState(state, filePath)` ensures `dirname(filePath)` exists via `mkdirSync(dirname(filePath), { recursive: true })` before writing `state.json`.
- **Ownership guarantees**:
  - Schema (`version: 1`, `firecrawl`, `mcp`, `tunnel`) and conservative ownership checks (`owned: boolean`, PID + `Win32_Process` command-line verification) remain unchanged.

### 5. `openai-firecrawl init` Command (`src/cli/init.ts`)

- **Behavior**:
  1. Resolves config path (`%APPDATA%\openai-firecrawl\.env`).
  2. Ensures `%APPDATA%\openai-firecrawl` directory exists (`mkdirSync(..., { recursive: true })`).
  3. Checks if `.env` already exists at that path:
     - **If it already exists**: Never overwrites it. Prints:
       ```text
       Config already exists (left unchanged):
       C:\Users\<user>\AppData\Roaming\openai-firecrawl\.env

       Edit the config if needed, then run:
       openai-firecrawl doctor
       ```
       and exits with code `0`.
     - **If it does not exist**: Writes the safe default template (matching `.env.example` with placeholder/commented values and zero real credentials) using `writeFileSync(configPath, TEMPLATE, { flag: "wx" })` and prints:
       ```text
       Config created:
       C:\Users\<user>\AppData\Roaming\openai-firecrawl\.env

       Edit the config, then run:
       openai-firecrawl doctor
       ```
       and exits with code `0`.

### 6. Binary & Package Asset Resolution in Global Installs

#### A. Official `firecrawl-mcp` Resolution (`src/mcp/process.ts`)
- Previously, `resolveFirecrawlMcpEntry(baseDir = process.cwd())` called `createRequire(resolve(baseDir, "package.json"))`. When run globally from an arbitrary directory (e.g. `C:\Users\<user>`), `process.cwd()` does not contain `openai-firecrawl`'s `node_modules`.
- **Fix**: Default `resolveFirecrawlMcpEntry` to resolve relative to `import.meta.url` (`createRequire(import.meta.url)`), which always resolves `firecrawl-mcp` from `@goravjhabakh/openai-firecrawl`'s own installed dependencies regardless of `process.cwd()`.

#### B. OpenAI `tunnel-client.exe` Resolution (`src/tunnel/process.ts`)
- For a global CLI, depending on `./bin/tunnel-client.exe` in `process.cwd()` is fragile and surprising. Instead, use a deterministic user-level drop-in path alongside `TUNNEL_CLIENT_BIN` and `PATH`:
  1. Explicit `TUNNEL_CLIENT_BIN` from environment / `%APPDATA%\openai-firecrawl\.env`
  2. User-level binary location: `%LOCALAPPDATA%\openai-firecrawl\bin\tunnel-client.exe`
  3. System `PATH` (`where.exe tunnel-client` on Windows)
- **Why**:
  - `TUNNEL_CLIENT_BIN` gives explicit control.
  - `%LOCALAPPDATA%\openai-firecrawl\bin\tunnel-client.exe` provides a clean, predictable drop-in folder for users who do not want to modify their system `PATH`, and survives `npm install -g` upgrades (unlike a folder inside `node_modules`).
  - `PATH` supports standard global tool installations.
  - No automatic downloading or bundling of `tunnel-client.exe`.
  - Error messages and `doctor` output will clearly list these 3 locations when `tunnel-client.exe` is not found.

### 7. Backward Compatibility & Migration Impact

- **Repo-local commands**:
  - `pnpm start`, `pnpm run doctor`, `pnpm stop`, and `pnpm run init` continue to work for development and run `tsx src/cli.ts <command>`. (Note: always use `pnpm run init` and `pnpm run doctor` rather than `pnpm init` / `pnpm doctor`, which conflict with built-in pnpm commands.)
- **Migration from repo-local `.env` and `.openai-firecrawl-state.json`**:
  - Configuration now loads from `%APPDATA%\openai-firecrawl\.env` instead of `<repo>/.env`.
  - Runtime state now loads/writes at `%LOCALAPPDATA%\openai-firecrawl\state.json` instead of `<repo>/.openai-firecrawl-state.json`.
  - **Impact on existing repo users**:
    - Before upgrading or switching to `v1.1.0`, if a stack is currently running under `v1.0.0`, the user should run `pnpm stop` once before upgrading, or copy their `<repo>/.env` values into `%APPDATA%\openai-firecrawl\.env` after running `openai-firecrawl init`.
    - No automatic file migration code will be added, keeping the codebase small and predictable.
    - Documentation (`README.md`, `docs/project.md`, `docs/architecture.md`, `docs/development.md`, `docs/troubleshooting.md`) will be updated to reflect the global CLI commands and user-level paths.

---

## Files to Add or Change

### New Files
- `specs/phase-5-global-cli.md` — Phase 5 specification
- `tsconfig.build.json` — TypeScript build config emitting `src/` to `dist/`
- `src/cli.ts` — Unified CLI entrypoint (`#!/usr/bin/env node`) and argument parser
- `src/cli/init.ts` — `openai-firecrawl init` implementation
- `tests/cli.test.ts` — Unit and integration tests for CLI parsing, `--help`, `--version`, `init`, and compiled `dist/cli.js` execution

### Modified Files
- `package.json` — `@goravjhabakh/openai-firecrawl`, `version: "1.1.0"`, `bin`, `files`, `publishConfig`, `build`/`prepack`/`init`/`start`/`doctor`/`stop` scripts
- `src/config/index.ts` — Add `getDefaultConfigDir()`, `getDefaultConfigFilePath()`, `CONFIG_TEMPLATE`, and update `loadConfig()` to read from `%APPDATA%\openai-firecrawl\.env` with `process.env` precedence
- `src/shared/state.ts` — Update `getDefaultStateFilePath()` to `%LOCALAPPDATA%\openai-firecrawl\state.json` and auto-create parent directory on write
- `src/mcp/process.ts` — Resolve `firecrawl-mcp` via `createRequire(import.meta.url)` instead of `process.cwd()`
- `src/tunnel/process.ts` — Resolve `tunnel-client.exe` via `TUNNEL_CLIENT_BIN` -> `%LOCALAPPDATA%\openai-firecrawl\bin\tunnel-client.exe` -> `PATH`
- `src/firecrawl/lifecycle.ts`, `src/mcp/lifecycle.ts`, `src/tunnel/lifecycle.ts` — Update error/doctor hints to reference the global config path and `openai-firecrawl` commands
- `src/cli/start.ts`, `src/cli/doctor.ts`, `src/cli/stop.ts` — Export reusable command runners (`runStartCommand`, `runDoctorCommand`, `runStopCommand`) called by `src/cli.ts`
- `tests/config.test.ts`, `tests/state.test.ts`, `tests/tunnel.test.ts` — Add tests for global path resolution, env-over-file precedence, state directory creation, and updated tunnel binary resolution
- `README.md`, `docs/project.md`, `docs/architecture.md`, `docs/development.md`, `docs/troubleshooting.md` — Document global npm install, `openai-firecrawl` commands, and `%APPDATA%` / `%LOCALAPPDATA%` paths

---

## Test & Verification Plan

### 1. Unit Tests (`vitest`)
- **CLI argument parsing (`tests/cli.test.ts`)**:
  - `init`, `start`, `doctor`, `stop` route to expected handlers
  - `--help` / `-h` and empty args print usage and return exit code `0`
  - `--version` / `-v` prints `1.1.0` and returns exit code `0`
  - Unknown commands (e.g. `openai-firecrawl foo`) or invalid flags print actionable error and return exit code `1`
- **Global config & `init` (`tests/config.test.ts` & `tests/cli.test.ts`)**:
  - `getDefaultConfigFilePath` resolves `%APPDATA%\openai-firecrawl\.env`
  - `loadConfig` applies `process.env` over `.env` file values, and `.env` file values over defaults
  - `init` creates directory and `.env` template when missing
  - `init` refuses to overwrite an existing `.env` file and leaves its contents intact
- **Global runtime state (`tests/state.test.ts`)**:
  - `getDefaultStateFilePath` resolves `%LOCALAPPDATA%\openai-firecrawl\state.json`
  - `writeRuntimeState` creates missing parent directories automatically
  - Existing ownership and partial-clear tests continue to pass
- **Asset resolution (`tests/mcp.test.ts` & `tests/tunnel.test.ts`)**:
  - `resolveFirecrawlMcpEntry()` succeeds even when `cwd` is a temporary directory outside the repository
  - `resolveTunnelClientBinary()` checks `TUNNEL_CLIENT_BIN`, then `%LOCALAPPDATA%\openai-firecrawl\bin\tunnel-client.exe`, then `PATH`
- **Compiled CLI execution (`tests/cli.test.ts`)**:
  - Execute `node dist/cli.js --version` and `node dist/cli.js --help` from a temporary directory outside the repository to verify standalone compiled behavior

### 2. Local Packaging & Global Install Verification
1. Run `pnpm check`, `pnpm typecheck`, `pnpm build`, and `pnpm test`.
2. Run `npm pack` to produce `goravjhabakh-openai-firecrawl-1.1.0.tgz` and inspect packaged file list (confirm only `dist/**`, `package.json`, `README.md`, `LICENSE` are included).
3. Install globally from the tarball:
   ```bash
   npm install -g ./goravjhabakh-openai-firecrawl-1.1.0.tgz
   ```
4. Change working directory outside the repository (e.g., `$env:TEMP`) and verify:
   ```bash
   openai-firecrawl --version
   openai-firecrawl --help
   openai-firecrawl init
   openai-firecrawl doctor
   openai-firecrawl start
   openai-firecrawl stop
   ```
5. Clean up the temporary `.tgz` artifact before committing.
