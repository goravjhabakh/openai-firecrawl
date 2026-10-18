# Architecture

## Overview

```text
+----------------------+
|       ChatGPT        |
+----------+-----------+
           |
           | MCP
           v
+----------------------+
| Custom MCP connection|
| / secure local link  |
+----------+-----------+
           |
           v
+----------------------+
| Official             |
| firecrawl-mcp        |
| localhost:<MCP_PORT> |
+----------+-----------+
           |
           | FIRECRAWL_API_URL
           v
+----------------------+
| Self-hosted          |
| Firecrawl            |
| localhost:3002       |
+----------+-----------+
           |
           v
          Web
```

## Responsibilities

### ChatGPT

Acts as the MCP host/client and invokes Firecrawl tools.

### ChatGPT MCP connection

Connects ChatGPT to the MCP server running on the developer machine.

The exact supported tunnel/local connection workflow must be verified against current OpenAI documentation during implementation rather than hard-coded from assumptions.

### Official Firecrawl MCP server

Exposes Firecrawl capabilities through MCP.

`openai-firecrawl` starts and monitors this component; it does not replace it.

### Self-hosted Firecrawl

Performs the actual scraping, search, mapping, and crawling.

The installation belongs to the user and remains a separate project.

### `openai-firecrawl`

Orchestration only:

- configuration
- prerequisite checks
- Firecrawl lifecycle
- MCP lifecycle
- connection lifecycle where supported
- diagnostics
- safe cleanup

## Process ownership

The project must track which processes it started.

If Firecrawl is already running when `pnpm start` begins, `pnpm stop` must leave it running.

## V1 platform

Windows 11 is the supported and tested platform for V1.

Keep implementation choices reasonably portable where this does not add complexity, but do not delay V1 for cross-platform support.
