# MCP Development

Use this skill for MCP-related work in `openai-firecrawl`.

## Sources of truth

Prefer current official sources in this order:

1. Model Context Protocol documentation
2. official MCP SDK repositories
3. official OpenAI documentation for ChatGPT MCP integration
4. official Firecrawl MCP documentation and source

When protocol or integration behavior may have changed, verify it instead of relying on memory.

MCP documentation starting point:

- https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro
- https://modelcontextprotocol.io/llms.txt

## Project rules

- This project orchestrates the official Firecrawl MCP server.
- Do not implement MCP protocol framing manually.
- Do not create a custom Firecrawl MCP server unless project scope explicitly changes.
- Prefer the official Firecrawl MCP package.
- Keep the self-hosted Firecrawl API separate from this repository.
- Do not require Firecrawl Cloud credentials for the local self-hosted path.

## Research workflow

When MCP behavior is unclear:

1. check the official MCP documentation
2. inspect the relevant official SDK/source when needed
3. check current OpenAI MCP documentation for ChatGPT-specific behavior
4. check Firecrawl's official MCP docs/source for Firecrawl-specific behavior

Record only project-relevant conclusions in the docs.

## Validation

Do not use ChatGPT as the first MCP debugger.

Validate in this order:

```text
Self-hosted Firecrawl
        ↓
Firecrawl MCP
        ↓
MCP Inspector
        ↓
ChatGPT
```

Use MCP Inspector for independent MCP validation when appropriate.

## Scope discipline

Prefer configuration and orchestration over custom protocol code.

Do not add abstractions, frameworks, or dependencies unless they solve a concrete problem in the current phase.
