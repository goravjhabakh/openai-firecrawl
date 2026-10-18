import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/index.js";
import {
  McpLifecycleError,
  ensureMcpRunning,
  probeMcpReadiness,
  runMcpDoctorChecks,
  stopManagedMcp,
} from "../src/mcp/index.js";
import type { McpRuntimeState, RuntimeState } from "../src/shared/state.js";

const DEFAULT_CONFIG: AppConfig = {
  firecrawlApiUrl: "http://localhost:3002",
  firecrawlHome: "C:/path/to/firecrawl",
  mcpPort: 3000,
};

describe("Mcp Probe", () => {
  it("detects ready service when POST /mcp returns JSON-RPC with firecrawl serverInfo", async () => {
    const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.endsWith("/mcp") && init?.method === "POST") {
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: {
                protocolVersion: "2025-11-25",
                capabilities: { tools: {} },
                serverInfo: {
                  name: "firecrawl-fastmcp",
                  version: "3.30.3",
                },
              },
            }),
        } as unknown as Response;
      }
      return { status: 404 } as unknown as Response;
    };

    const res = await probeMcpReadiness(3000, mockFetch as typeof fetch);
    expect(res.status).toBe("ready");
    expect(res.serverName).toBe("firecrawl-fastmcp");
    expect(res.endpointTested).toBe("http://localhost:3000/mcp");
  });

  it("detects ready service when POST /mcp returns SSE text/event-stream with firecrawl serverInfo", async () => {
    const ssePayload =
      'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{}},"serverInfo":{"name":"firecrawl-fastmcp","version":"3.30.3"}}}\n\n';

    const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.endsWith("/mcp") && init?.method === "POST") {
        return {
          status: 200,
          text: async () => ssePayload,
        } as unknown as Response;
      }
      return { status: 404 } as unknown as Response;
    };

    const res = await probeMcpReadiness(3000, mockFetch as typeof fetch);
    expect(res.status).toBe("ready");
    expect(res.serverName).toBe("firecrawl-fastmcp");
  });

  it("detects port-occupied when /mcp returns unrelated non-firecrawl HTTP response", async () => {
    const mockFetch = async () =>
      ({
        status: 404,
        text: async () => "Cannot POST /mcp - Express 404",
      }) as unknown as Response;

    const res = await probeMcpReadiness(3000, mockFetch as typeof fetch);
    expect(res.status).toBe("port-occupied");
    expect(res.httpStatus).toBe(404);
  });

  it("detects port-occupied when /mcp fails to connect but root / responds with HTTP traffic", async () => {
    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.endsWith("/mcp")) {
        throw new Error("fetch failed (not an mcp server)");
      }
      if (urlStr.endsWith(":3000/")) {
        return { status: 200 } as unknown as Response;
      }
      throw new Error("ECONNREFUSED");
    };

    const res = await probeMcpReadiness(3000, mockFetch as typeof fetch);
    expect(res.status).toBe("port-occupied");
    expect(res.httpStatus).toBe(200);
  });

  it("detects unreachable when nothing responds on the port", async () => {
    const mockFetch = async () => {
      throw new Error("ECONNREFUSED");
    };

    const res = await probeMcpReadiness(3000, mockFetch as typeof fetch);
    expect(res.status).toBe("unreachable");
    expect(res.error).toContain("ECONNREFUSED");
  });
});

describe("ensureMcpRunning", () => {
  it("detects already running instance and marks owned: false for external instance", async () => {
    let savedMcpState: McpRuntimeState | undefined;

    const result = await ensureMcpRunning(DEFAULT_CONFIG, {
      probe: async () => ({
        status: "ready",
        endpointTested: "http://localhost:3000/mcp",
        serverName: "firecrawl-fastmcp",
      }),
      readState: () => null,
      updateState: (m) => {
        savedMcpState = m;
        return { version: 1, updatedAt: "", mcp: m };
      },
    });

    expect(result.status).toBe("already-running");
    expect(result.owned).toBe(false);
    expect(savedMcpState?.owned).toBe(false);
  });

  it("detects already running instance and preserves owned: true if previously managed and PID alive", async () => {
    let savedMcpState: McpRuntimeState | undefined;

    const existingState: RuntimeState = {
      version: 1,
      updatedAt: "2026-10-18T10:00:00.000Z",
      mcp: {
        owned: true,
        pid: 1234,
        port: 3000,
        mcpUrl: "http://localhost:3000/mcp",
        firecrawlApiUrl: "http://localhost:3002",
      },
    };

    const result = await ensureMcpRunning(DEFAULT_CONFIG, {
      probe: async () => ({
        status: "ready",
        endpointTested: "http://localhost:3000/mcp",
        serverName: "firecrawl-fastmcp",
      }),
      isAliveAndOwned: async (pid) => pid === 1234,
      readState: () => existingState,
      updateState: (m) => {
        savedMcpState = m;
        return { version: 1, updatedAt: "", mcp: m };
      },
    });

    expect(result.status).toBe("already-running");
    expect(result.owned).toBe(true);
    expect(result.pid).toBe(1234);
    expect(savedMcpState?.owned).toBe(true);
    expect(savedMcpState?.pid).toBe(1234);
  });

  it("throws clear error when port is occupied by another service", async () => {
    await expect(
      ensureMcpRunning(DEFAULT_CONFIG, {
        probe: async () => ({
          status: "port-occupied",
          endpointTested: "http://localhost:3000/mcp",
          httpStatus: 404,
          detail: "Non-Firecrawl HTTP server",
        }),
      })
    ).rejects.toThrow(McpLifecycleError);
  });

  it("spawns mcp process and marks owned: true when port is free", async () => {
    let spawned = false;
    let savedMcpState: McpRuntimeState | undefined;

    const result = await ensureMcpRunning(DEFAULT_CONFIG, {
      probe: async () => ({
        status: "unreachable",
        endpointTested: "http://localhost:3000/mcp",
      }),
      resolveEntry: () => ({
        entryPath: "C:/mock/firecrawl-mcp/dist/index.js",
        version: "3.30.3",
      }),
      spawn: () => {
        spawned = true;
        return { pid: 9999, entryPath: "C:/mock/firecrawl-mcp/dist/index.js" };
      },
      waitForReady: async () => ({
        status: "ready",
        endpointTested: "http://localhost:3000/mcp",
        serverName: "firecrawl-fastmcp",
      }),
      updateState: (m) => {
        savedMcpState = m;
        return { version: 1, updatedAt: "", mcp: m };
      },
    });

    expect(spawned).toBe(true);
    expect(result.status).toBe("started");
    expect(result.owned).toBe(true);
    expect(result.pid).toBe(9999);
    expect(savedMcpState?.owned).toBe(true);
    expect(savedMcpState?.pid).toBe(9999);
  });
});

describe("stopManagedMcp", () => {
  it("skips stopping when no state exists", async () => {
    let terminated = false;

    const result = await stopManagedMcp(DEFAULT_CONFIG, {
      readState: () => null,
      terminate: async () => {
        terminated = true;
        return true;
      },
    });

    expect(result.action).toBe("skipped-no-state");
    expect(terminated).toBe(false);
  });

  it("skips stopping when mcp is not owned", async () => {
    let terminated = false;

    const result = await stopManagedMcp(DEFAULT_CONFIG, {
      readState: () => ({
        version: 1,
        updatedAt: "",
        mcp: {
          owned: false,
          port: 3000,
          mcpUrl: "http://localhost:3000/mcp",
          firecrawlApiUrl: "http://localhost:3002",
        },
      }),
      terminate: async () => {
        terminated = true;
        return true;
      },
    });

    expect(result.action).toBe("skipped-not-owned");
    expect(terminated).toBe(false);
  });

  it("handles dead PID safely without throwing", async () => {
    let stateCleared = false;
    let terminated = false;

    const result = await stopManagedMcp(DEFAULT_CONFIG, {
      readState: () => ({
        version: 1,
        updatedAt: "",
        mcp: {
          owned: true,
          pid: 8888,
          port: 3000,
          mcpUrl: "http://localhost:3000/mcp",
          firecrawlApiUrl: "http://localhost:3002",
        },
      }),
      isAliveAndOwned: async () => false, // Dead process or PID reused
      terminate: async () => {
        terminated = true;
        return true;
      },
      clearState: () => {
        stateCleared = true;
        return true;
      },
    });

    expect(result.action).toBe("already-stopped");
    expect(terminated).toBe(false);
    expect(stateCleared).toBe(true);
  });

  it("terminates verified owned PID and clears state", async () => {
    let stateCleared = false;
    let terminatedPid: number | undefined;

    const result = await stopManagedMcp(DEFAULT_CONFIG, {
      readState: () => ({
        version: 1,
        updatedAt: "",
        mcp: {
          owned: true,
          pid: 7777,
          port: 3000,
          mcpUrl: "http://localhost:3000/mcp",
          firecrawlApiUrl: "http://localhost:3002",
        },
      }),
      isAliveAndOwned: async (pid) => pid === 7777,
      terminate: async (pid) => {
        terminatedPid = pid;
        return true;
      },
      clearState: () => {
        stateCleared = true;
        return true;
      },
    });

    expect(result.action).toBe("stopped");
    expect(terminatedPid).toBe(7777);
    expect(stateCleared).toBe(true);
  });
});

describe("runMcpDoctorChecks", () => {
  it("reports passes for healthy MCP setup", async () => {
    const items = await runMcpDoctorChecks(DEFAULT_CONFIG, {
      resolveEntry: () => ({
        entryPath: "C:/mock/firecrawl-mcp/dist/index.js",
        version: "3.30.3",
      }),
      probe: async () => ({
        status: "ready",
        endpointTested: "http://localhost:3000/mcp",
        serverName: "firecrawl-fastmcp",
        detail: "Ready",
      }),
      readState: () => ({
        version: 1,
        updatedAt: "2026-10-18T10:00:00.000Z",
        mcp: {
          owned: true,
          pid: 1234,
          port: 3000,
          mcpUrl: "http://localhost:3000/mcp",
          firecrawlApiUrl: "http://localhost:3002",
        },
      }),
    });

    expect(items.every((i) => i.status === "PASS")).toBe(true);
    expect(items.length).toBe(3);
  });
});
