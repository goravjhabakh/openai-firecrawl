import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/index.js";
import type { RuntimeState, TunnelRuntimeState } from "../src/shared/state.js";
import {
  TunnelLifecycleError,
  ensureTunnelRunning,
  getDefaultTunnelClientBinPath,
  probeTunnelReadiness,
  resolveTunnelClientBinary,
  runTunnelDoctorChecks,
  stopManagedTunnel,
} from "../src/tunnel/index.js";

const TEST_TUNNEL_ID = "tunnel_0123456789abcdef0123456789abcdef";

const DEFAULT_CONFIG: AppConfig = {
  firecrawlApiUrl: "http://localhost:3002",
  firecrawlHome: "C:/path/to/firecrawl",
  mcpPort: 3000,
  tunnelId: TEST_TUNNEL_ID,
  hasTunnelApiKey: true,
  tunnelApiKeyEnvVar: "CONTROL_PLANE_API_KEY",
  tunnelClientBin: undefined,
  tunnelHealthPort: 8080,
};

describe("Tunnel Readiness & Health Probe", () => {
  it("detects ready service when /readyz returns 200 and /health confirms tunnel-client", async () => {
    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.endsWith("/healthz")) {
        return {
          status: 200,
          text: async () => "live\n",
        } as unknown as Response;
      }
      if (urlStr.includes("/health?details=true")) {
        return {
          status: 200,
          json: async () => ({
            schema_version: 1,
            live: true,
            ready: true,
            runtime: { version: "0.0.16", flavor: "full" },
            components: {
              "control-plane": { status: "ok", state: "polling" },
            },
          }),
        } as unknown as Response;
      }
      if (urlStr.endsWith("/api/status")) {
        return {
          status: 200,
          json: async () => ({
            version: "0.0.16",
            control_plane_tunnel_id: "tunnel_0123456789abcdef0123456789abcdef",
            mcp_server_url: "http://localhost:3000/mcp",
          }),
        } as unknown as Response;
      }
      if (urlStr.endsWith("/readyz")) {
        return {
          status: 200,
          text: async () => "ready\n",
        } as unknown as Response;
      }
      return { status: 404 } as unknown as Response;
    };

    const res = await probeTunnelReadiness(8080, DEFAULT_CONFIG, mockFetch as typeof fetch);
    expect(res.status).toBe("ready");
    expect(res.readyzStatus).toBe(200);
    expect(res.version).toBe("0.0.16");
    expect(res.tunnelId).toBe("tunnel_0123456789abcdef0123456789abcdef");
  });

  it("detects starting service when /healthz is 200 but /readyz is 503", async () => {
    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.endsWith("/healthz")) {
        return {
          status: 200,
          text: async () => "live\n",
        } as unknown as Response;
      }
      if (urlStr.includes("/health?details=true")) {
        return {
          status: 200,
          json: async () => ({
            schema_version: 1,
            live: true,
            ready: false,
          }),
        } as unknown as Response;
      }
      if (urlStr.endsWith("/readyz")) {
        return {
          status: 503,
          text: async () => "oauth discovery pending\n",
        } as unknown as Response;
      }
      return { status: 404 } as unknown as Response;
    };

    const res = await probeTunnelReadiness(8080, DEFAULT_CONFIG, mockFetch as typeof fetch);
    expect(res.status).toBe("starting");
    expect(res.readyzStatus).toBe(503);
    expect(res.readyzBody).toBe("oauth discovery pending");
  });

  it("detects misconfigured-instance when /api/status has different tunnel ID", async () => {
    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.endsWith("/healthz")) {
        return { status: 200, text: async () => "live\n" } as unknown as Response;
      }
      if (urlStr.endsWith("/api/status")) {
        return {
          status: 200,
          json: async () => ({
            control_plane_tunnel_id: "tunnel_different_12345678901234567890123456789012",
            mcp_server_url: "http://localhost:3000/mcp",
          }),
        } as unknown as Response;
      }
      if (urlStr.endsWith("/readyz")) {
        return { status: 200, text: async () => "ready\n" } as unknown as Response;
      }
      return { status: 404 } as unknown as Response;
    };

    const res = await probeTunnelReadiness(8080, DEFAULT_CONFIG, mockFetch as typeof fetch);
    expect(res.status).toBe("misconfigured-instance");
    expect(res.detail).toContain("tunnel_different_");
  });

  it("detects port-occupied when /healthz responds with non-tunnel content", async () => {
    const mockFetch = async () =>
      ({
        status: 200,
        text: async () => "<html>Apache Tomcat</html>",
        json: async () => {
          throw new Error("not json");
        },
      }) as unknown as Response;

    const res = await probeTunnelReadiness(8080, DEFAULT_CONFIG, mockFetch as typeof fetch);
    expect(res.status).toBe("port-occupied");
  });

  it("detects unreachable when nothing responds on port", async () => {
    const mockFetch = async () => {
      throw new Error("ECONNREFUSED");
    };

    const res = await probeTunnelReadiness(8080, DEFAULT_CONFIG, mockFetch as typeof fetch);
    expect(res.status).toBe("unreachable");
    expect(res.error).toContain("ECONNREFUSED");
  });
});

describe("ensureTunnelRunning", () => {
  it("fails early if CONTROL_PLANE_TUNNEL_ID is missing", async () => {
    const configWithoutTunnel: AppConfig = {
      ...DEFAULT_CONFIG,
      tunnelId: undefined,
    };

    await expect(ensureTunnelRunning(configWithoutTunnel)).rejects.toThrow(TunnelLifecycleError);
  });

  it("fails early if tunnel runtime API key is missing", async () => {
    const configWithoutKey: AppConfig = {
      ...DEFAULT_CONFIG,
      hasTunnelApiKey: false,
    };

    await expect(ensureTunnelRunning(configWithoutKey)).rejects.toThrow(TunnelLifecycleError);
  });

  it("detects already running instance and marks owned: false for external instance", async () => {
    let savedTunnelState: TunnelRuntimeState | undefined;

    const result = await ensureTunnelRunning(DEFAULT_CONFIG, {
      probe: async () => ({
        status: "ready",
        healthPort: 8080,
        healthUrl: "http://127.0.0.1:8080",
        version: "0.0.16",
        tunnelId: DEFAULT_CONFIG.tunnelId,
      }),
      readState: () => null,
      updateState: (t) => {
        savedTunnelState = t;
        return { version: 1, updatedAt: "", tunnel: t };
      },
    });

    expect(result.status).toBe("already-running");
    expect(result.owned).toBe(false);
    expect(savedTunnelState?.owned).toBe(false);
  });

  it("detects already running instance and preserves owned: true if previously managed and PID alive", async () => {
    let savedTunnelState: TunnelRuntimeState | undefined;

    const existingState: RuntimeState = {
      version: 1,
      updatedAt: "2026-10-18T10:00:00.000Z",
      tunnel: {
        owned: true,
        pid: 4321,
        tunnelId: TEST_TUNNEL_ID,
        mcpUrl: "http://localhost:3000/mcp",
        healthPort: 8080,
        healthUrl: "http://127.0.0.1:8080",
      },
    };

    const result = await ensureTunnelRunning(DEFAULT_CONFIG, {
      probe: async () => ({
        status: "ready",
        healthPort: 8080,
        healthUrl: "http://127.0.0.1:8080",
        version: "0.0.16",
        tunnelId: DEFAULT_CONFIG.tunnelId,
      }),
      isAliveAndOwned: async (pid) => pid === 4321,
      readState: () => existingState,
      updateState: (t) => {
        savedTunnelState = t;
        return { version: 1, updatedAt: "", tunnel: t };
      },
    });

    expect(result.status).toBe("already-running");
    expect(result.owned).toBe(true);
    expect(result.pid).toBe(4321);
    expect(savedTunnelState?.owned).toBe(true);
    expect(savedTunnelState?.pid).toBe(4321);
  });

  it("fails immediately on port conflict without spawning", async () => {
    let spawnCalled = false;

    await expect(
      ensureTunnelRunning(DEFAULT_CONFIG, {
        probe: async () => ({
          status: "port-occupied",
          healthPort: 8080,
          healthUrl: "http://127.0.0.1:8080",
          detail: "Foreign HTTP service",
        }),
        spawn: () => {
          spawnCalled = true;
          return { pid: 1234, binPath: "tunnel-client.exe" };
        },
      })
    ).rejects.toThrow(TunnelLifecycleError);

    expect(spawnCalled).toBe(false);
  });

  it("spawns tunnel process and records owned: true when port is free", async () => {
    let spawned = false;
    let savedTunnelState: TunnelRuntimeState | undefined;

    const result = await ensureTunnelRunning(DEFAULT_CONFIG, {
      probe: async () => ({
        status: "unreachable",
        healthPort: 8080,
        healthUrl: "http://127.0.0.1:8080",
      }),
      resolveBinary: async () => ({
        binPath: "C:/bin/tunnel-client.exe",
        version: "0.0.16",
      }),
      spawn: () => {
        spawned = true;
        return { pid: 7890, binPath: "C:/bin/tunnel-client.exe" };
      },
      waitForReady: async () => ({
        status: "ready",
        healthPort: 8080,
        healthUrl: "http://127.0.0.1:8080",
        version: "0.0.16",
        tunnelId: DEFAULT_CONFIG.tunnelId,
      }),
      updateState: (t) => {
        savedTunnelState = t;
        return { version: 1, updatedAt: "", tunnel: t };
      },
    });

    expect(spawned).toBe(true);
    expect(result.status).toBe("started");
    expect(result.owned).toBe(true);
    expect(result.pid).toBe(7890);
    expect(savedTunnelState?.owned).toBe(true);
    expect(savedTunnelState?.pid).toBe(7890);
  });
});

describe("stopManagedTunnel", () => {
  it("skips stopping when no state exists", async () => {
    let terminated = false;

    const result = await stopManagedTunnel(DEFAULT_CONFIG, {
      readState: () => null,
      terminate: async () => {
        terminated = true;
        return true;
      },
    });

    expect(result.action).toBe("skipped-no-state");
    expect(terminated).toBe(false);
  });

  it("skips stopping when tunnel is not owned", async () => {
    let terminated = false;

    const result = await stopManagedTunnel(DEFAULT_CONFIG, {
      readState: () => ({
        version: 1,
        updatedAt: "",
        tunnel: {
          owned: false,
          healthPort: 8080,
          healthUrl: "http://127.0.0.1:8080",
          tunnelId: TEST_TUNNEL_ID,
          mcpUrl: "http://localhost:3000/mcp",
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

  it("terminates verified owned PID and clears state", async () => {
    let stateCleared = false;
    let terminatedPid: number | undefined;

    const result = await stopManagedTunnel(DEFAULT_CONFIG, {
      readState: () => ({
        version: 1,
        updatedAt: "",
        tunnel: {
          owned: true,
          pid: 5555,
          healthPort: 8080,
          healthUrl: "http://127.0.0.1:8080",
          tunnelId: TEST_TUNNEL_ID,
          mcpUrl: "http://localhost:3000/mcp",
        },
      }),
      isAliveAndOwned: async (pid) => pid === 5555,
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
    expect(terminatedPid).toBe(5555);
    expect(stateCleared).toBe(true);
  });
});

describe("runTunnelDoctorChecks", () => {
  it("reports passes for healthy Tunnel setup", async () => {
    const items = await runTunnelDoctorChecks(DEFAULT_CONFIG, {
      resolveBinary: async () => ({
        binPath: "C:/tools/tunnel-client.exe",
        version: "0.0.16",
      }),
      probe: async () => ({
        status: "ready",
        healthPort: 8080,
        healthUrl: "http://127.0.0.1:8080",
        version: "0.0.16",
        tunnelId: DEFAULT_CONFIG.tunnelId,
        mcpServerUrl: "http://localhost:3000/mcp",
      }),
      readState: () => ({
        version: 1,
        updatedAt: "2026-10-18T10:00:00.000Z",
        tunnel: {
          owned: true,
          pid: 5555,
          tunnelId: TEST_TUNNEL_ID,
          mcpUrl: "http://localhost:3000/mcp",
          healthPort: 8080,
          healthUrl: "http://127.0.0.1:8080",
        },
      }),
    });

    expect(items.every((i) => i.status === "PASS")).toBe(true);
    expect(items.length).toBe(4);
  });
});

describe("resolveTunnelClientBinary", () => {
  it("resolves user-level tunnel-client binary path under LOCALAPPDATA", async () => {
    const fixtureLocalAppData = resolve(process.cwd(), "tests", "fixtures", "localappdata");
    const binDir = join(fixtureLocalAppData, "openai-firecrawl", "bin");
    const exePath = getDefaultTunnelClientBinPath({ LOCALAPPDATA: fixtureLocalAppData });

    mkdirSync(binDir, { recursive: true });
    writeFileSync(exePath, "mock-binary", "utf8");

    try {
      const resolved = await resolveTunnelClientBinary(
        { tunnelClientBin: undefined },
        async () => ({ exitCode: 0, stdout: "tunnel-client v0.0.16", stderr: "" }),
        { LOCALAPPDATA: fixtureLocalAppData }
      );

      expect(resolved.binPath).toBe(exePath);
      expect(resolved.version).toBe("tunnel-client v0.0.16");
    } finally {
      rmSync(fixtureLocalAppData, { recursive: true, force: true });
    }
  });
});
