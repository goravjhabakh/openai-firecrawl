# Project

## Problem

Developers can self-host Firecrawl locally, but ChatGPT's normal Firecrawl integration uses hosted Firecrawl infrastructure.

`openai-firecrawl` provides a simple local orchestration layer so ChatGPT can use a developer's self-hosted Firecrawl instance through MCP.

## Target users

Primary:

- developers already self-hosting Firecrawl
- ChatGPT users who want their local Firecrawl instance available as a custom MCP connection

V1 is built and tested on Windows 11.

## V1 scope

The project will:

- read local configuration from `.env`
- check whether Docker is available
- check whether the configured Firecrawl API is reachable
- start the user's existing Firecrawl Docker Compose stack when needed
- start the official Firecrawl MCP server
- verify local Firecrawl and MCP readiness
- support a ChatGPT custom MCP connection
- provide `start`, `doctor`, and `stop` commands
- provide clear diagnostics for common setup failures

Initial Firecrawl capabilities to verify:

- scrape
- search
- map
- crawl

Other tools may work but are not part of the initial acceptance criteria.

## Non-goals

V1 will not:

- reimplement Firecrawl
- build a custom MCP server
- redistribute the Firecrawl Docker stack
- provide a web UI
- guarantee macOS or Linux support
- reproduce Firecrawl's full self-hosting documentation

## Configuration

```env
FIRECRAWL_API_URL=http://localhost:3002
FIRECRAWL_HOME=C:/path/to/firecrawl
MCP_PORT=3000
```

`FIRECRAWL_HOME` points to an existing Firecrawl checkout and is used when the project needs to start its Docker Compose stack.

## Commands

### `pnpm start`

Bring the local integration to a ready state.

Expected flow:

1. Validate configuration.
2. Check Docker.
3. Check Firecrawl.
4. Start Firecrawl if required.
5. Wait for readiness.
6. Start Firecrawl MCP.
7. Verify MCP.
8. Start or verify the ChatGPT MCP connection.
9. Print the final status.

### `pnpm doctor`

Check prerequisites and report actionable diagnostics without changing more state than necessary.

### `pnpm stop`

Stop processes started by `openai-firecrawl`.

Do not stop an already-running Firecrawl deployment that was not started by this project.

## Success criteria

V1 is complete when:

1. `pnpm start` can bring a valid local setup to a ready state.
2. ChatGPT can call the local MCP server.
3. A scrape request reaches the self-hosted Firecrawl API.
4. scrape, search, map, and crawl are verified.
5. no Firecrawl Cloud API key is required for the self-hosted path.
6. `pnpm doctor` clearly identifies common failures.
7. `pnpm stop` behaves safely.
