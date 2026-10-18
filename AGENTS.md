# AGENTS.md

## Project

`openai-firecrawl` is a small Windows-first TypeScript project that connects ChatGPT to an existing self-hosted Firecrawl installation through the official Firecrawl MCP server.

The project orchestrates existing components. It does not reimplement Firecrawl or the MCP protocol.

## Read first

Before implementing a phase, read:

- `README.md`
- `docs/project.md`
- `docs/architecture.md`
- `docs/development.md`
- the relevant file under `specs/`

Use `.agents/skills/mcp-development/SKILL.md` for MCP-related work.

## Stack

- Node.js
- TypeScript
- pnpm
- Biome
- Vitest
- Docker / Docker Compose
- official Firecrawl MCP server

Use strict TypeScript.

## Working style

- Work in small, coherent batches.
- Follow the current phase spec; do not implement future phases early.
- Prefer the simplest implementation that satisfies the requirement.
- Do not introduce frameworks or abstractions without a clear need.
- Keep modules small and responsibilities clear.
- Reuse official tools and packages instead of rebuilding them.

## Architecture boundaries

Do not:

- implement a custom Firecrawl MCP server in V1
- implement MCP framing or protocol handling manually
- bundle or fork Firecrawl into this repository
- require Firecrawl Cloud credentials for the self-hosted path
- add a UI
- add cross-platform complexity before Windows V1 works

## Commands

Target commands:

```bash
pnpm start
pnpm run doctor
pnpm stop

pnpm check
pnpm typecheck
pnpm test
```

## Testing

Use minimal Vitest unit tests for logic such as configuration and lifecycle decisions.

Use real local services for integration verification:

- Docker
- self-hosted Firecrawl
- Firecrawl MCP
- MCP Inspector
- ChatGPT custom MCP connection

Do not chase arbitrary coverage targets.

## Safety

Process lifecycle must be conservative.

- Detect whether Firecrawl was already running.
- Do not stop a pre-existing Firecrawl instance just because this project stops.
- Validate paths and required tools before starting processes.
- Fail with actionable errors.
- Never log secrets.

## Documentation

Keep docs short and current.

Update lasting documentation when implementation changes behavior. Do not turn implementation specs into large essays.
