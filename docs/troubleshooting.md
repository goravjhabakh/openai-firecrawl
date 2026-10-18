# Troubleshooting

Run `openai-firecrawl doctor` (or `pnpm run doctor` during repo development) first whenever something fails. It checks every layer (Configuration, Docker, Firecrawl, MCP, Tunnel, and Process Ownership) and prints specific remediation steps.

## Configuration file not found

Run:

```bash
openai-firecrawl init
```

This creates `%APPDATA%\openai-firecrawl\.env` without overwriting any existing configuration.

## Docker is unavailable

Check:

```bash
docker version
docker compose version
```

Ensure Docker Desktop is running before executing `openai-firecrawl start`.

## Firecrawl cannot be reached or fails to start

1. Verify `FIRECRAWL_API_URL` in `%APPDATA%\openai-firecrawl\.env` (default `http://localhost:3002`).
2. If you want `openai-firecrawl` to start Firecrawl automatically, ensure `FIRECRAWL_HOME` points to your self-hosted Firecrawl checkout containing `docker-compose.yaml` (or `compose.yaml`).
3. If pre-existing Firecrawl containers exist in `FIRECRAWL_HOME` but the API is unhealthy, `openai-firecrawl` will not overwrite or tear down your containers. Inspect your Firecrawl logs directly:

```bash
cd C:/path/to/firecrawl
docker compose ps
docker compose logs --tail=100
```

## `MCP_PORT` or `TUNNEL_HEALTH_PORT` conflict

`openai-firecrawl` verifies service signatures before starting or reusing processes:

- If `MCP_PORT` (default `3000`) is occupied by another web server (such as Next.js or Express), `openai-firecrawl start` fails safely without killing the foreign process. Either stop the other server or change `MCP_PORT` in `%APPDATA%\openai-firecrawl\.env`.
- If `TUNNEL_HEALTH_PORT` (default `8080`) is occupied by another service, or by a `tunnel-client` instance bound to a different `tunnel_id` or MCP URL, stop the conflicting process or change `TUNNEL_HEALTH_PORT` in `%APPDATA%\openai-firecrawl\.env`.

## `tunnel-client` binary not found

`openai-firecrawl` does not auto-download executables from the internet.

1. Download `tunnel-client-vX.Y.Z-windows-amd64.zip` from [Platform Settings → Tunnels](https://platform.openai.com/settings/organization/tunnels) or [GitHub Releases](https://github.com/openai/tunnel-client/releases/latest).
2. Place `tunnel-client.exe` on your system `PATH`, in `%LOCALAPPDATA%\openai-firecrawl\bin\tunnel-client.exe`, or set `TUNNEL_CLIENT_BIN=C:/path/to/tunnel-client.exe` in `%APPDATA%\openai-firecrawl\.env`.

## Tunnel fails to become ready (`/readyz` timeout or exit)

Verify:

1. `CONTROL_PLANE_TUNNEL_ID` in `%APPDATA%\openai-firecrawl\.env` matches the `tunnel_...` ID created in [OpenAI Platform Tunnels](https://platform.openai.com/settings/organization/tunnels).
2. `CONTROL_PLANE_API_KEY` in `%APPDATA%\openai-firecrawl\.env` is a valid OpenAI API key whose principal has Tunnels **Read** + **Use** permissions.
3. `firecrawl-mcp` is healthy on `http://localhost:<MCP_PORT>/mcp`.
4. Run `openai-firecrawl doctor` to execute `tunnel-client doctor` preflight diagnostics.

## ChatGPT cannot connect or invoke tools

Verify in order:

1. `openai-firecrawl start` completed with `SUCCESS` and `openai-firecrawl doctor` passes all checks.
2. Open `http://127.0.0.1:8080/ui` (or your configured `TUNNEL_HEALTH_PORT`) to confirm the local tunnel is connected and polling.
3. In [OpenAI Platform Tunnels](https://platform.openai.com/settings/organization/tunnels), confirm the tunnel is linked to your target **ChatGPT workspace**.
4. In ChatGPT (**Settings → Connectors → Add custom MCP server**), confirm:
   - **Connection:** `Tunnel`
   - **Tunnel ID:** matches `CONTROL_PLANE_TUNNEL_ID`
   - **Authentication:** `No authentication`

## `openai-firecrawl stop` leaves Firecrawl, MCP, or Tunnel running

This is intentional when those processes were already running before `openai-firecrawl start` began (`owned: false` in `%LOCALAPPDATA%\openai-firecrawl\state.json`). `openai-firecrawl` only stops processes that it started itself.
