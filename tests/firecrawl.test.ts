import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/index.js";
import {
  FirecrawlLifecycleError,
  ensureFirecrawlRunning,
  probeFirecrawlReadiness,
  runDoctorChecks,
  stopManagedFirecrawl,
} from "../src/firecrawl/index.js";
import type { FirecrawlRuntimeState, RuntimeState } from "../src/shared/state.js";

const DEFAULT_CONFIG: AppConfig = {
  firecrawlApiUrl: "http://localhost:3002",
  firecrawlHome: "C:/path/to/firecrawl",
  mcpPort: 3000,
};

describe("Firecrawl Probe", () => {
  it("detects ready service when /v0/health/readiness returns { status: ok }", async () => {
    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("/v0/health/readiness")) {
        return {
          status: 200,
          json: async () => ({ status: "ok" }),
        } as unknown as Response;
      }
      return { status: 404 } as unknown as Response;
    };

    const res = await probeFirecrawlReadiness("http://localhost:3002", mockFetch as typeof fetch);
    expect(res.ready).toBe(true);
    expect(res.endpointTested).toBe("http://localhost:3002/v0/health/readiness");
  });

  it("detects ready service when root / returns Firecrawl API text", async () => {
    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("/v0/health/readiness")) {
        return { status: 404 } as unknown as Response;
      }
      if (urlStr.endsWith("/")) {
        return {
          status: 200,
          text: async () =>
            '{"message":"Firecrawl API","documentation_url":"https://docs.firecrawl.dev"}',
        } as unknown as Response;
      }
      return { status: 404 } as unknown as Response;
    };

    const res = await probeFirecrawlReadiness("http://localhost:3002", mockFetch as typeof fetch);
    expect(res.ready).toBe(true);
    expect(res.endpointTested).toBe("http://localhost:3002/");
  });

  it("rejects non-Firecrawl service responding with random content", async () => {
    const mockFetch = async () =>
      ({
        status: 200,
        json: async () => ({ status: "unrelated" }),
        text: async () => "Welcome to Apache Server",
      }) as unknown as Response;

    const res = await probeFirecrawlReadiness("http://localhost:3002", mockFetch as typeof fetch);
    expect(res.ready).toBe(false);
  });

  it("handles fetch rejection gracefully", async () => {
    const mockFetch = async () => {
      throw new Error("ECONNREFUSED");
    };

    const res = await probeFirecrawlReadiness("http://localhost:3002", mockFetch as typeof fetch);
    expect(res.ready).toBe(false);
    expect(res.error).toContain("ECONNREFUSED");
  });
});

describe("ensureFirecrawlRunning", () => {
  it("detects already running instance and marks owned: false for external instance", async () => {
    let savedState: { owned?: boolean } = {};

    const result = await ensureFirecrawlRunning(DEFAULT_CONFIG, {
      probe: async () => ({
        ready: true,
        endpointTested: "http://localhost:3002/v0/health/readiness",
      }),
      readState: () => null,
      updateState: (s) => {
        savedState = s;
        return { version: 1, updatedAt: "", firecrawl: s };
      },
    });

    expect(result.status).toBe("already-running");
    expect(result.owned).toBe(false);
    expect(savedState.owned).toBe(false);
  });

  it("detects already running instance and preserves owned: true if previously managed", async () => {
    let savedState: { owned?: boolean } = {};

    const existingState: RuntimeState = {
      version: 1,
      updatedAt: "2026-10-18T10:00:00.000Z",
      firecrawl: {
        owned: true,
        apiUrl: "http://localhost:3002",
        firecrawlHome: "C:/path/to/firecrawl",
      },
    };

    const result = await ensureFirecrawlRunning(DEFAULT_CONFIG, {
      probe: async () => ({
        ready: true,
        endpointTested: "http://localhost:3002/v0/health/readiness",
      }),
      readState: () => existingState,
      updateState: (s) => {
        savedState = s;
        return { version: 1, updatedAt: "", firecrawl: s };
      },
    });

    expect(result.status).toBe("already-running");
    expect(result.owned).toBe(true);
    expect(savedState.owned).toBe(true);
  });

  it("throws clear error when not running and FIRECRAWL_HOME is invalid/missing", async () => {
    await expect(
      ensureFirecrawlRunning(
        { ...DEFAULT_CONFIG, firecrawlHome: undefined },
        {
          probe: async () => ({
            ready: false,
            endpointTested: "http://localhost:3002",
            error: "ECONNREFUSED",
          }),
          validateHome: () => ({ valid: false, error: "FIRECRAWL_HOME is not set." }),
        }
      )
    ).rejects.toThrow(FirecrawlLifecycleError);
  });

  it("throws clear error when not running and Docker is unavailable", async () => {
    await expect(
      ensureFirecrawlRunning(DEFAULT_CONFIG, {
        probe: async () => ({
          ready: false,
          endpointTested: "http://localhost:3002",
          error: "ECONNREFUSED",
        }),
        validateHome: () => ({ valid: true, composeFilePath: "docker-compose.yaml" }),
        checkDocker: async () => ({
          available: false,
          error: "Docker daemon not running",
        }),
      })
    ).rejects.toThrow(FirecrawlLifecycleError);
  });

  it("detects pre-existing Compose containers and does NOT claim ownership or tear them down", async () => {
    let savedState: { owned?: boolean } = {};

    const result = await ensureFirecrawlRunning(DEFAULT_CONFIG, {
      probe: async () => ({
        ready: false,
        endpointTested: "http://localhost:3002",
        error: "ECONNREFUSED",
      }),
      validateHome: () => ({ valid: true, composeFilePath: "docker-compose.yaml" }),
      checkDocker: async () => ({ available: true }),
      inspectCompose: async () => ({
        hasExistingContainers: true,
        containers: [{ service: "api", state: "running", status: "Up 2 minutes" }],
      }),
      // Probe succeeds during wait
      waitForReady: async () => ({
        ready: true,
        endpointTested: "http://localhost:3002/v0/health/readiness",
      }),
      updateState: (s) => {
        savedState = s;
        return { version: 1, updatedAt: "", firecrawl: s };
      },
    });

    expect(result.status).toBe("existing-containers-detected");
    expect(result.owned).toBe(false);
    expect(savedState.owned).toBe(false);
  });

  it("starts compose and records owned: true when containers are genuinely absent", async () => {
    let composeStarted = false;
    let savedState: { owned?: boolean } = {};

    const result = await ensureFirecrawlRunning(DEFAULT_CONFIG, {
      probe: async () => ({
        ready: false,
        endpointTested: "http://localhost:3002",
        error: "ECONNREFUSED",
      }),
      validateHome: () => ({ valid: true, composeFilePath: "docker-compose.yaml" }),
      checkDocker: async () => ({ available: true }),
      inspectCompose: async () => ({
        hasExistingContainers: false,
        containers: [],
      }),
      startCompose: async () => {
        composeStarted = true;
        return { exitCode: 0, stdout: "Started", stderr: "" };
      },
      waitForReady: async () => ({
        ready: true,
        endpointTested: "http://localhost:3002/v0/health/readiness",
      }),
      updateState: (s) => {
        savedState = s;
        return { version: 1, updatedAt: "", firecrawl: s };
      },
    });

    expect(composeStarted).toBe(true);
    expect(result.status).toBe("started");
    expect(result.owned).toBe(true);
    expect(savedState.owned).toBe(true);
  });
});

describe("stopManagedFirecrawl", () => {
  it("skips stopping when no state exists", async () => {
    let composeStopped = false;

    const result = await stopManagedFirecrawl(DEFAULT_CONFIG, {
      readState: () => null,
      stopCompose: async () => {
        composeStopped = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(result.action).toBe("skipped-no-state");
    expect(composeStopped).toBe(false);
  });

  it("skips stopping when instance is not owned", async () => {
    let composeStopped = false;

    const result = await stopManagedFirecrawl(DEFAULT_CONFIG, {
      readState: () => ({
        version: 1,
        updatedAt: "",
        firecrawl: {
          owned: false,
          apiUrl: "http://localhost:3002",
          firecrawlHome: "C:/path/to/firecrawl",
        },
      }),
      stopCompose: async () => {
        composeStopped = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(result.action).toBe("skipped-not-owned");
    expect(composeStopped).toBe(false);
  });

  it("stops compose and clears state when instance is owned", async () => {
    let composeStopped = false;
    let stateCleared = false;

    const result = await stopManagedFirecrawl(DEFAULT_CONFIG, {
      readState: () => ({
        version: 1,
        updatedAt: "",
        firecrawl: {
          owned: true,
          apiUrl: "http://localhost:3002",
          firecrawlHome: "C:/path/to/firecrawl",
        },
      }),
      checkDocker: async () => ({ available: true }),
      stopCompose: async () => {
        composeStopped = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      clearState: () => {
        stateCleared = true;
        return true;
      },
    });

    expect(result.action).toBe("stopped");
    expect(composeStopped).toBe(true);
    expect(stateCleared).toBe(true);
  });
});

describe("runDoctorChecks", () => {
  it("reports passes for healthy setup", async () => {
    const report = await runDoctorChecks(DEFAULT_CONFIG, {
      checkDocker: async () => ({
        available: true,
        serverVersion: "27.0",
        composeVersion: "v2.29",
      }),
      validateHome: () => ({ valid: true, composeFilePath: "docker-compose.yaml" }),
      probe: async () => ({
        ready: true,
        endpointTested: "http://localhost:3002/v0/health/readiness",
        detail: "ok",
      }),
      inspectCompose: async () => ({
        hasExistingContainers: true,
        containers: [{ service: "api", status: "running" }],
      }),
      readState: () => ({
        version: 1,
        updatedAt: "2026-10-18T10:00:00.000Z",
        firecrawl: {
          owned: true,
          apiUrl: "http://localhost:3002",
        },
      }),
    });

    expect(report.success).toBe(true);
    expect(report.items.every((i) => i.status === "PASS")).toBe(true);
  });
});
