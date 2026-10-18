export type McpProbeStatus = "ready" | "port-occupied" | "unreachable";

export interface McpProbeResult {
  readonly status: McpProbeStatus;
  readonly endpointTested: string;
  readonly httpStatus?: number | undefined;
  readonly serverName?: string | undefined;
  readonly detail?: string | undefined;
  readonly error?: string | undefined;
}

export interface WaitForMcpReadyOptions {
  readonly timeoutMs?: number | undefined;
  readonly intervalMs?: number | undefined;
  readonly probe?: (port: number) => Promise<McpProbeResult>;
}

export class McpHealthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpHealthError";
  }
}

/**
 * Standard MCP initialize JSON-RPC request.
 * Uses LATEST_PROTOCOL_VERSION (2025-11-25) supported by @modelcontextprotocol/sdk.
 */
function createInitializePayload(): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: {
        name: "openai-firecrawl-probe",
        version: "1.0.0",
      },
    },
  });
}

/**
 * Try to parse an MCP initialize response from either JSON or SSE text.
 */
function extractServerInfo(text: string): { serverName?: string } | null {
  // 1. Direct JSON-RPC response
  try {
    const parsed = JSON.parse(text) as {
      result?: { serverInfo?: { name?: unknown } };
    };
    if (parsed && typeof parsed === "object" && parsed.result?.serverInfo?.name) {
      return { serverName: String(parsed.result.serverInfo.name) };
    }
  } catch {
    // Not pure JSON; check SSE lines
  }

  // 2. Server-Sent Events (SSE) format: "data: {...}"
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith("data:")) {
      try {
        const dataJson = line.slice(5).trim();
        const parsed = JSON.parse(dataJson) as {
          result?: { serverInfo?: { name?: unknown } };
        };
        if (parsed && typeof parsed === "object" && parsed.result?.serverInfo?.name) {
          return { serverName: String(parsed.result.serverInfo.name) };
        }
      } catch {
        // Continue searching
      }
    }
  }

  return null;
}

/**
 * Probe MCP Streamable HTTP endpoint at http://localhost:<port>/mcp.
 * Distinguishes:
 * - "ready": Valid Firecrawl MCP server responding to initialize.
 * - "port-occupied": Port responds to HTTP traffic, but not as Firecrawl MCP.
 * - "unreachable": No HTTP service listening on the port (connection refused / timeout).
 */
export async function probeMcpReadiness(
  port: number,
  fetchFn: typeof fetch = fetch
): Promise<McpProbeResult> {
  const mcpEndpoint = `http://localhost:${port}/mcp`;

  try {
    const res = await fetchFn(mcpEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: createInitializePayload(),
      signal: AbortSignal.timeout(3000),
    });

    const responseText = await res.text().catch(() => "");
    const info = extractServerInfo(responseText);

    // Official firecrawl-mcp server sets name: "firecrawl-fastmcp"
    if (res.status === 200 && info?.serverName?.toLowerCase().includes("firecrawl")) {
      return {
        status: "ready",
        endpointTested: mcpEndpoint,
        httpStatus: 200,
        serverName: info.serverName,
        detail: `Valid Firecrawl MCP server responded (${info.serverName}).`,
      };
    }

    // Endpoint answered, but it is not Firecrawl MCP.
    return {
      status: "port-occupied",
      endpointTested: mcpEndpoint,
      httpStatus: res.status,
      detail: `Port ${port} is occupied by another service (HTTP status ${res.status}). Expected Firecrawl MCP initialize response.`,
    };
  } catch (err) {
    // POST /mcp failed to connect or timed out.
    // Check if root http://localhost:<port>/ responds to verify if another service occupies the port.
    try {
      const rootRes = await fetchFn(`http://localhost:${port}/`, {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });

      // If root responds at all, the port is occupied by another web server.
      return {
        status: "port-occupied",
        endpointTested: `http://localhost:${port}/`,
        httpStatus: rootRes.status,
        detail: `Port ${port} is occupied by another service (responded with HTTP ${rootRes.status} at root).`,
      };
    } catch {
      // Nothing listening on this port.
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: "unreachable",
        endpointTested: mcpEndpoint,
        error: msg,
        detail: `Port ${port} is free (no service responding): ${msg}`,
      };
    }
  }
}

/**
 * Poll until Firecrawl MCP is ready or bounded timeout expires.
 */
export async function waitForMcpReady(
  port: number,
  options: WaitForMcpReadyOptions = {}
): Promise<McpProbeResult> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const intervalMs = options.intervalMs ?? 500;
  const probe = options.probe ?? ((p) => probeMcpReadiness(p));

  const startTime = Date.now();
  let lastResult: McpProbeResult | undefined;

  while (Date.now() - startTime < timeoutMs) {
    lastResult = await probe(port);
    if (lastResult.status === "ready") {
      return lastResult;
    }

    const elapsed = Date.now() - startTime;
    if (elapsed + intervalMs >= timeoutMs) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const detail = lastResult?.error || lastResult?.detail || "Timeout exceeded";
  throw new McpHealthError(
    `Firecrawl MCP on port ${port} did not become ready within ${Math.round(timeoutMs / 1000)} seconds. Detail: ${detail}`
  );
}
