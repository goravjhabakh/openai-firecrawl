# openai-firecrawl

Connect ChatGPT to a self-hosted Firecrawl instance through the official Firecrawl MCP server.

The project is intentionally small: it orchestrates existing components rather than reimplementing Firecrawl or MCP.

## Goal

Provide a simple local workflow for developers who self-host Firecrawl and want ChatGPT to use that instance instead of relying on Firecrawl Cloud credits.

## Planned flow

```text
ChatGPT
  |
Custom MCP connection
  |
Secure/local MCP connection
  |
Official firecrawl-mcp
  |
Self-hosted Firecrawl
```

## V1

Windows-first.

Planned commands:

```bash
pnpm start
pnpm doctor
pnpm stop
```

`pnpm start` should:

1. Load and validate configuration.
2. Check Docker and the configured Firecrawl endpoint.
3. Start the existing Firecrawl Docker stack when needed.
4. Start the official Firecrawl MCP server.
5. Verify the MCP endpoint.
6. Start or verify the ChatGPT MCP connection.
7. Report a clear ready state.

## Configuration

Expected `.env` values:

```env
FIRECRAWL_API_URL=http://localhost:3002
FIRECRAWL_HOME=C:/path/to/firecrawl
MCP_PORT=3000
```

A Firecrawl Cloud API key should not be required for the self-hosted path.

## Requirements

- Windows 11 for V1
- Docker Desktop
- Node.js
- pnpm
- An existing self-hosted Firecrawl installation
- ChatGPT with support for adding a custom MCP server

If Firecrawl is not installed yet, use the official Firecrawl self-hosting documentation. This repository does not redistribute or maintain Firecrawl.

## Status

Planning and foundation work.

See:

- `docs/project.md`
- `docs/architecture.md`
- `docs/development.md`
- `docs/troubleshooting.md`

Implementation specs will be created and executed incrementally with an AI coding agent.
