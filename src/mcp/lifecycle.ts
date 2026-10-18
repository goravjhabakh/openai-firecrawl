import type { AppConfig } from "../config/index.js";
import {
  type McpRuntimeState,
  type RuntimeState,
  clearMcpState,
  readRuntimeState,
  updateMcpState,
} from "../shared/state.js";
import {
  McpHealthError,
  type McpProbeResult,
  probeMcpReadiness,
  waitForMcpReady,
} from "./health.js";
import {
  type McpProcessResolution,
  type SpawnMcpProcessOptions,
  type SpawnMcpResult,
  isMcpProcessAliveAndOwned,
  resolveFirecrawlMcpEntry,
  spawnMcpProcess,
  terminateMcpProcess,
} from "./process.js";

export class McpLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpLifecycleError";
  }
}

export interface EnsureMcpRunningResult {
  readonly status: "already-running" | "started";
  readonly owned: boolean;
  readonly pid?: number | undefined;
  readonly port: number;
  readonly mcpUrl: string;
  readonly detail: string;
}

export interface StopManagedMcpResult {
  readonly action: "stopped" | "skipped-not-owned" | "skipped-no-state" | "already-stopped";
  readonly message: string;
  readonly pid?: number | undefined;
  readonly port?: number | undefined;
}

export interface McpDoctorCheckItem {
  readonly status: "PASS" | "WARN" | "FAIL";
  readonly title: string;
  readonly details: readonly string[];
}

export interface McpLifecycleDependencies {
  readonly probe?: (port: number) => Promise<McpProbeResult>;
  readonly waitForReady?: (
    port: number,
    options?: { timeoutMs?: number; intervalMs?: number }
  ) => Promise<McpProbeResult>;
  readonly resolveEntry?: () => McpProcessResolution;
  readonly spawn?: (options: SpawnMcpProcessOptions) => SpawnMcpResult;
  readonly isAliveAndOwned?: (pid: number) => Promise<boolean>;
  readonly terminate?: (pid: number) => Promise<boolean>;
  readonly readState?: () => RuntimeState | null;
  readonly updateState?: (mcp: McpRuntimeState) => RuntimeState;
  readonly clearState?: () => boolean;
}

export async function ensureMcpRunning(
  config: AppConfig,
  deps: McpLifecycleDependencies = {}
): Promise<EnsureMcpRunningResult> {
  const probe = deps.probe ?? probeMcpReadiness;
  const waitForReady = deps.waitForReady ?? waitForMcpReady;
  const resolveEntry = deps.resolveEntry ?? resolveFirecrawlMcpEntry;
  const spawn = deps.spawn ?? spawnMcpProcess;
  const isAliveAndOwned = deps.isAliveAndOwned ?? isMcpProcessAliveAndOwned;
  const terminate = deps.terminate ?? terminateMcpProcess;
  const readState = deps.readState ?? readRuntimeState;
  const updateState = deps.updateState ?? updateMcpState;
  const clearState = deps.clearState ?? clearMcpState;

  const mcpUrl = `http://localhost:${config.mcpPort}/mcp`;

  // 1. Check if an MCP server or another service is already active on MCP_PORT
  const probeRes = await probe(config.mcpPort);

  if (probeRes.status === "port-occupied") {
    throw new McpLifecycleError(
      `Port ${config.mcpPort} is already in use by another service (${probeRes.detail ?? "non-Firecrawl service"}). Cannot start Firecrawl MCP server. Please stop the conflicting service or configure a different MCP_PORT in .env.`
    );
  }

  if (probeRes.status === "ready") {
    // A valid Firecrawl MCP server is already responding.
    const existingState = readState();
    let isOwned = false;
    let retainedPid: number | undefined;

    if (
      existingState?.mcp?.owned === true &&
      existingState.mcp.port === config.mcpPort &&
      existingState.mcp.pid !== undefined
    ) {
      const pidStillValid = await isAliveAndOwned(existingState.mcp.pid);
      if (pidStillValid) {
        isOwned = true;
        retainedPid = existingState.mcp.pid;
      }
    }

    updateState({
      owned: isOwned,
      pid: retainedPid,
      port: config.mcpPort,
      mcpUrl,
      firecrawlApiUrl: config.firecrawlApiUrl,
      startedAt: existingState?.mcp?.startedAt ?? new Date().toISOString(),
    });

    return {
      status: "already-running",
      owned: isOwned,
      pid: retainedPid,
      port: config.mcpPort,
      mcpUrl,
      detail: isOwned
        ? `Firecrawl MCP is already running and managed by this project (PID ${retainedPid}).`
        : "Firecrawl MCP is already running (external instance).",
    };
  }

  // 2. Port is unreachable. Verify package resolution before spawning.
  try {
    resolveEntry();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new McpLifecycleError(`Cannot start Firecrawl MCP server: ${msg}`);
  }

  // 3. Spawn detached firecrawl-mcp process
  let spawnResult: SpawnMcpResult;
  try {
    spawnResult = spawn({ config });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new McpLifecycleError(`Failed to spawn firecrawl-mcp: ${msg}`);
  }

  // Record ownership immediately so cleanup can occur even if wait fails
  updateState({
    owned: true,
    pid: spawnResult.pid,
    port: config.mcpPort,
    mcpUrl,
    firecrawlApiUrl: config.firecrawlApiUrl,
    startedAt: new Date().toISOString(),
  });

  // 4. Wait for readiness
  try {
    await waitForReady(config.mcpPort, { timeoutMs: 15_000, intervalMs: 500 });
  } catch (err) {
    // Kill the spawned process if still alive
    await terminate(spawnResult.pid).catch(() => {});
    clearState();
    const msg = err instanceof Error ? err.message : String(err);
    throw new McpLifecycleError(
      `Spawned Firecrawl MCP process (PID ${spawnResult.pid}) but server failed to become ready: ${msg}`
    );
  }

  return {
    status: "started",
    owned: true,
    pid: spawnResult.pid,
    port: config.mcpPort,
    mcpUrl,
    detail: `Firecrawl MCP server started and verified ready at ${mcpUrl} (PID ${spawnResult.pid}).`,
  };
}

export async function stopManagedMcp(
  config: AppConfig,
  deps: McpLifecycleDependencies = {}
): Promise<StopManagedMcpResult> {
  const readState = deps.readState ?? readRuntimeState;
  const clearState = deps.clearState ?? clearMcpState;
  const isAliveAndOwned = deps.isAliveAndOwned ?? isMcpProcessAliveAndOwned;
  const terminate = deps.terminate ?? terminateMcpProcess;

  const state = readState();

  if (!state || !state.mcp) {
    return {
      action: "skipped-no-state",
      message: "No managed MCP state found. No MCP processes were stopped.",
    };
  }

  const { owned, pid, port } = state.mcp;

  if (!owned || pid === undefined) {
    return {
      action: "skipped-not-owned",
      message: `MCP server on port ${port} was not started by this project. Leaving existing instance running.`,
      port,
    };
  }

  // Instance was marked owned. Verify PID is still alive and belongs to firecrawl-mcp.
  const isValidPid = await isAliveAndOwned(pid);
  if (!isValidPid) {
    clearState();
    return {
      action: "already-stopped",
      message: `Managed MCP process (PID ${pid}) was no longer running. Cleaned up state entry.`,
      pid,
      port,
    };
  }

  // Process is confirmed alive and owned; terminate it.
  const terminated = await terminate(pid);
  clearState();

  if (!terminated) {
    throw new McpLifecycleError(
      `Failed to terminate managed Firecrawl MCP process with PID ${pid}.`
    );
  }

  return {
    action: "stopped",
    message: `Stopped managed Firecrawl MCP process (PID ${pid}) on port ${port}.`,
    pid,
    port,
  };
}

export async function runMcpDoctorChecks(
  config: AppConfig,
  deps: McpLifecycleDependencies = {}
): Promise<McpDoctorCheckItem[]> {
  const resolveEntry = deps.resolveEntry ?? resolveFirecrawlMcpEntry;
  const probe = deps.probe ?? probeMcpReadiness;
  const readState = deps.readState ?? readRuntimeState;

  const items: McpDoctorCheckItem[] = [];

  // 1. Package resolution check
  try {
    const { entryPath, version } = resolveEntry();
    items.push({
      status: "PASS",
      title: "Firecrawl MCP Package",
      details: [`Package version: ${version}`, `Executable entry: ${entryPath}`],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    items.push({
      status: "FAIL",
      title: "Firecrawl MCP Package",
      details: [msg],
    });
  }

  // 2. Endpoint reachability & readiness
  const probeRes = await probe(config.mcpPort);
  if (probeRes.status === "ready") {
    items.push({
      status: "PASS",
      title: "MCP Endpoint Readiness",
      details: [
        `URL: http://localhost:${config.mcpPort}/mcp`,
        `Server: ${probeRes.serverName ?? "firecrawl-fastmcp"}`,
        `Status: ${probeRes.detail ?? "Ready"}`,
      ],
    });
  } else if (probeRes.status === "port-occupied") {
    items.push({
      status: "FAIL",
      title: "MCP Port Conflict",
      details: [
        `Port ${config.mcpPort} is in use by another service.`,
        probeRes.detail ?? "Expected Firecrawl MCP initialize response.",
      ],
    });
  } else {
    items.push({
      status: "PASS",
      title: "MCP Port Availability",
      details: [
        `Port ${config.mcpPort} is free and ready for startup.`,
        `Target endpoint: http://localhost:${config.mcpPort}/mcp`,
      ],
    });
  }

  // 3. MCP Process Ownership State
  const state = readState();
  if (state?.mcp) {
    items.push({
      status: "PASS",
      title: "MCP Process Ownership State",
      details: [
        `Managed by openai-firecrawl: ${state.mcp.owned ? "YES (owned)" : "NO (external)"}`,
        `Recorded PID: ${state.mcp.pid ?? "(none)"}`,
        `Recorded Port: ${state.mcp.port}`,
        `Target URL: ${state.mcp.mcpUrl}`,
        `Last updated: ${state.updatedAt}`,
      ],
    });
  } else {
    items.push({
      status: "PASS",
      title: "MCP Process Ownership State",
      details: ["No active local MCP runtime state recorded."],
    });
  }

  return items;
}
