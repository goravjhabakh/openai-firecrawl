# Troubleshooting

This file should stay practical and short. Add entries only for failures we actually encounter.

## Docker is unavailable

Check:

```bash
docker version
docker compose version
```

Ensure Docker Desktop is running.

## Firecrawl cannot be reached

Check the configured endpoint:

```text
FIRECRAWL_API_URL
```

Then verify the existing Firecrawl stack is running.

Useful checks:

```bash
docker ps
docker compose ps
```

If auto-start is enabled through `FIRECRAWL_HOME`, verify that the path points to the correct Firecrawl checkout.

## Firecrawl starts but never becomes ready

Inspect the Firecrawl containers and logs from the Firecrawl repository.

Do not debug ChatGPT or MCP until the Firecrawl API itself is healthy.

## MCP server does not start

Verify:

- Node.js is available
- the official Firecrawl MCP package can run
- `FIRECRAWL_API_URL` points to the self-hosted instance
- `MCP_PORT` is free

Use MCP Inspector to validate the server independently.

## ChatGPT cannot connect

First verify:

1. Firecrawl is healthy.
2. Firecrawl MCP is healthy.
3. MCP Inspector can connect.

Only then troubleshoot the ChatGPT custom MCP/tunnel configuration.

Because ChatGPT's MCP connection workflow can change, use current OpenAI documentation during implementation and troubleshooting.

## `pnpm stop` leaves Firecrawl running

This can be correct.

If Firecrawl was already running before `openai-firecrawl` started, the project should not stop it.

## Port conflict

Check which process owns the configured MCP port and either stop that process or change `MCP_PORT`.
