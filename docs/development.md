# Development

## Stack

- Node.js
- TypeScript
- pnpm
- Biome
- Vitest

Use strict TypeScript and small modules.

## Planned source layout

```text
src/
├── cli/
│   ├── start.ts
│   ├── doctor.ts
│   └── stop.ts
├── config/
├── firecrawl/
├── mcp/
├── tunnel/
└── shared/
```

CLI files should coordinate actions. Reusable logic belongs in the internal modules.

## Setup

```bash
pnpm install
```

Create `.env` from `.env.example` once the foundation phase adds it.

Expected values:

```env
FIRECRAWL_API_URL=http://localhost:3002
FIRECRAWL_HOME=C:/path/to/firecrawl
MCP_PORT=3000
```

## Quality commands

```bash
pnpm check
pnpm typecheck
pnpm test
```

## Testing strategy

### Unit tests

Use Vitest for small logic that benefits from deterministic tests, such as:

- configuration validation
- lifecycle decisions
- process ownership decisions

Keep tests focused. No coverage target is required.

### Integration verification

Use real services for the important path:

1. self-hosted Firecrawl
2. official Firecrawl MCP server
3. MCP Inspector
4. ChatGPT custom MCP connection

Validate the MCP endpoint independently before debugging ChatGPT.

## AI-agent workflow

OpenCode is the primary coding agent.

For each phase:

1. read `AGENTS.md`
2. read the core docs
3. read the current phase spec
4. implement only that phase
5. run relevant checks/tests
6. summarize changes and unresolved issues
7. update lasting docs only when behavior changed

Work directly on `main` for this small project. Keep commits small and meaningful.

## Dependency policy

Prefer built-in Node APIs and established official packages.

Add a dependency only when it clearly reduces complexity or improves reliability.
