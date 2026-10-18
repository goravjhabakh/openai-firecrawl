import type { AppConfig } from "../config/index.js";
import {
  type RuntimeState,
  type TunnelRuntimeState,
  clearTunnelState,
  readRuntimeState,
  updateTunnelState,
} from "../shared/state.js";
import {
  TunnelHealthError,
  type TunnelProbeResult,
  probeTunnelReadiness,
  waitForTunnelReady,
} from "./health.js";
import {
  type SpawnTunnelProcessOptions,
  type SpawnTunnelResult,
  type TunnelBinaryResolution,
  type TunnelDoctorPreflightResult,
  isTunnelProcessAliveAndOwned,
  resolveTunnelClientBinary,
  runTunnelClientPreflight,
  spawnTunnelProcess,
  terminateTunnelProcess,
} from "./process.js";

export class TunnelLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TunnelLifecycleError";
  }
}

export interface EnsureTunnelRunningResult {
  readonly status: "already-running" | "started";
  readonly owned: boolean;
  readonly pid?: number | undefined;
  readonly tunnelId: string;
  readonly healthPort: number;
  readonly healthUrl: string;
  readonly mcpUrl: string;
  readonly detail: string;
  readonly version?: string | undefined;
}

export interface StopManagedTunnelResult {
  readonly action: "stopped" | "skipped-not-owned" | "skipped-no-state" | "already-stopped";
  readonly message: string;
  readonly pid?: number | undefined;
  readonly healthPort?: number | undefined;
  readonly tunnelId?: string | undefined;
}

export interface TunnelDoctorCheckItem {
  readonly status: "PASS" | "WARN" | "FAIL";
  readonly title: string;
  readonly details: readonly string[];
}

export interface TunnelLifecycleDependencies {
  readonly probe?: (
    healthPort: number,
    config: Pick<AppConfig, "tunnelId" | "mcpPort">
  ) => Promise<TunnelProbeResult>;
  readonly waitForReady?: (
    healthPort: number,
    config: AppConfig,
    options?: {
      timeoutMs?: number;
      intervalMs?: number;
      isChildAlive?: () => boolean | Promise<boolean>;
    }
  ) => Promise<TunnelProbeResult>;
  readonly resolveBinary?: (
    config: Pick<AppConfig, "tunnelClientBin">
  ) => Promise<TunnelBinaryResolution>;
  readonly preflightDoctor?: (
    binPath: string,
    config: AppConfig
  ) => Promise<TunnelDoctorPreflightResult>;
  readonly spawn?: (options: SpawnTunnelProcessOptions) => SpawnTunnelResult;
  readonly isAliveAndOwned?: (pid: number) => Promise<boolean>;
  readonly terminate?: (pid: number) => Promise<boolean>;
  readonly readState?: () => RuntimeState | null;
  readonly updateState?: (tunnel: TunnelRuntimeState) => RuntimeState;
  readonly clearState?: () => boolean;
}

export async function ensureTunnelRunning(
  config: AppConfig,
  deps: TunnelLifecycleDependencies = {}
): Promise<EnsureTunnelRunningResult> {
  const probe = deps.probe ?? probeTunnelReadiness;
  const waitForReady = deps.waitForReady ?? waitForTunnelReady;
  const resolveBinary = deps.resolveBinary ?? resolveTunnelClientBinary;
  const spawn = deps.spawn ?? spawnTunnelProcess;
  const isAliveAndOwned = deps.isAliveAndOwned ?? isTunnelProcessAliveAndOwned;
  const terminate = deps.terminate ?? terminateTunnelProcess;
  const readState = deps.readState ?? readRuntimeState;
  const updateState = deps.updateState ?? updateTunnelState;
  const clearState = deps.clearState ?? clearTunnelState;

  // 1. Validate required tunnel configuration
  if (!config.tunnelId) {
    throw new TunnelLifecycleError(
      "CONTROL_PLANE_TUNNEL_ID is not configured. Please create or copy a tunnel ID from Platform settings (https://platform.openai.com/settings/organization/tunnels) and set CONTROL_PLANE_TUNNEL_ID in .env."
    );
  }

  if (!config.hasTunnelApiKey) {
    throw new TunnelLifecycleError(
      "No OpenAI runtime API key configured for tunnel-client. Please create an API key in Platform settings (https://platform.openai.com/settings/organization/api-keys) with Tunnels Read+Use permissions and set CONTROL_PLANE_API_KEY in .env."
    );
  }

  const mcpUrl = `http://localhost:${config.mcpPort}/mcp`;
  const healthUrl = `http://127.0.0.1:${config.tunnelHealthPort}`;

  // 2. Check if a service is already running on the tunnel health port
  const probeRes = await probe(config.tunnelHealthPort, config);

  if (probeRes.status === "port-occupied") {
    throw new TunnelLifecycleError(
      `Port ${config.tunnelHealthPort} is occupied by another service (${probeRes.detail ?? "non-tunnel service"}). Cannot start OpenAI Secure MCP Tunnel. Please stop the conflicting service or configure a different TUNNEL_HEALTH_PORT in .env.`
    );
  }

  if (probeRes.status === "misconfigured-instance") {
    throw new TunnelLifecycleError(
      `A running tunnel-client was found on port ${config.tunnelHealthPort}, but it is misconfigured: ${probeRes.detail}`
    );
  }

  if (probeRes.status === "ready") {
    // Valid tunnel-client is already responding and ready
    const existingState = readState();
    let isOwned = false;
    let retainedPid: number | undefined;

    if (
      existingState?.tunnel?.owned === true &&
      existingState.tunnel.healthPort === config.tunnelHealthPort &&
      existingState.tunnel.pid !== undefined
    ) {
      const pidStillValid = await isAliveAndOwned(existingState.tunnel.pid);
      if (pidStillValid) {
        isOwned = true;
        retainedPid = existingState.tunnel.pid;
      }
    }

    updateState({
      owned: isOwned,
      pid: retainedPid,
      tunnelId: config.tunnelId,
      mcpUrl,
      healthPort: config.tunnelHealthPort,
      healthUrl,
      startedAt: existingState?.tunnel?.startedAt ?? new Date().toISOString(),
    });

    return {
      status: "already-running",
      owned: isOwned,
      pid: retainedPid,
      tunnelId: config.tunnelId,
      healthPort: config.tunnelHealthPort,
      healthUrl,
      mcpUrl,
      version: probeRes.version,
      detail: isOwned
        ? `OpenAI Secure MCP Tunnel is already running and managed by this project (PID ${retainedPid}).`
        : "OpenAI Secure MCP Tunnel is already running (external instance).",
    };
  }

  // 3. Port is free (or starting). If unreachable, resolve binary and spawn process.
  let activePid: number | undefined;
  if (probeRes.status === "unreachable") {
    let binResolution: TunnelBinaryResolution;
    try {
      binResolution = await resolveBinary(config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TunnelLifecycleError(`Cannot start OpenAI Secure MCP Tunnel: ${msg}`);
    }

    let spawnResult: SpawnTunnelResult;
    try {
      spawnResult = spawn({ config, binPath: binResolution.binPath });
      activePid = spawnResult.pid;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TunnelLifecycleError(`Failed to spawn tunnel-client: ${msg}`);
    }

    // Record ownership immediately so cleanup can occur even if wait fails
    updateState({
      owned: true,
      pid: spawnResult.pid,
      tunnelId: config.tunnelId,
      mcpUrl,
      healthPort: config.tunnelHealthPort,
      healthUrl,
      startedAt: new Date().toISOString(),
    });
  }

  // 4. Wait for readiness gate (/readyz HTTP 200)
  try {
    const childPid = activePid;
    const readyResult = await waitForReady(config.tunnelHealthPort, config, {
      timeoutMs: 20_000,
      intervalMs: 500,
      ...(childPid !== undefined ? { isChildAlive: async () => isAliveAndOwned(childPid) } : {}),
    });

    return {
      status: activePid !== undefined ? "started" : "already-running",
      owned: activePid !== undefined,
      pid: activePid,
      tunnelId: config.tunnelId,
      healthPort: config.tunnelHealthPort,
      healthUrl,
      mcpUrl,
      version: readyResult.version,
      detail: `OpenAI Secure MCP Tunnel started and verified ready (PID ${activePid ?? "(unknown)"}).`,
    };
  } catch (err) {
    if (activePid !== undefined) {
      await terminate(activePid).catch(() => {});
      clearState();
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new TunnelLifecycleError(`OpenAI Secure MCP Tunnel failed to become ready: ${msg}`);
  }
}

export async function stopManagedTunnel(
  config: AppConfig,
  deps: TunnelLifecycleDependencies = {}
): Promise<StopManagedTunnelResult> {
  const readState = deps.readState ?? readRuntimeState;
  const clearState = deps.clearState ?? clearTunnelState;
  const isAliveAndOwned = deps.isAliveAndOwned ?? isTunnelProcessAliveAndOwned;
  const terminate = deps.terminate ?? terminateTunnelProcess;

  const state = readState();

  if (!state || !state.tunnel) {
    return {
      action: "skipped-no-state",
      message: "No managed tunnel state found. No tunnel processes were stopped.",
    };
  }

  const { owned, pid, healthPort, tunnelId } = state.tunnel;

  if (!owned || pid === undefined) {
    return {
      action: "skipped-not-owned",
      message: `OpenAI Secure MCP Tunnel on port ${healthPort} was not started by this project. Leaving existing instance running.`,
      healthPort,
      tunnelId,
    };
  }

  // Instance was marked owned. Verify PID is still alive and belongs to tunnel-client.
  const isValidPid = await isAliveAndOwned(pid);
  if (!isValidPid) {
    clearState();
    return {
      action: "already-stopped",
      message: `Managed tunnel process (PID ${pid}) was no longer running. Cleaned up state entry.`,
      pid,
      healthPort,
      tunnelId,
    };
  }

  // Terminate verified process
  const terminated = await terminate(pid);
  clearState();

  if (!terminated) {
    throw new TunnelLifecycleError(
      `Failed to terminate managed tunnel-client process with PID ${pid}.`
    );
  }

  return {
    action: "stopped",
    message: `Stopped managed OpenAI Secure MCP Tunnel process (PID ${pid}) on port ${healthPort}.`,
    pid,
    healthPort,
    tunnelId,
  };
}

export async function runTunnelDoctorChecks(
  config: AppConfig,
  deps: TunnelLifecycleDependencies = {}
): Promise<TunnelDoctorCheckItem[]> {
  const probe = deps.probe ?? probeTunnelReadiness;
  const resolveBinary = deps.resolveBinary ?? resolveTunnelClientBinary;
  const preflightDoctor = deps.preflightDoctor ?? runTunnelClientPreflight;
  const readState = deps.readState ?? readRuntimeState;

  const items: TunnelDoctorCheckItem[] = [];

  // Check 1: Tunnel Configuration & Credentials
  const configDetails: string[] = [];
  let configPass = true;

  if (config.tunnelId) {
    configDetails.push(`Tunnel ID: ${config.tunnelId}`);
  } else {
    configPass = false;
    configDetails.push(
      "CONTROL_PLANE_TUNNEL_ID is not configured in .env.",
      "Get a tunnel ID at https://platform.openai.com/settings/organization/tunnels"
    );
  }

  if (config.hasTunnelApiKey) {
    configDetails.push(`Runtime API key source: ${config.tunnelApiKeyEnvVar} (configured)`);
  } else {
    configPass = false;
    configDetails.push(
      "CONTROL_PLANE_API_KEY (or OPENAI_API_KEY) is not configured in .env.",
      "Create a runtime key with Tunnels Read+Use at https://platform.openai.com/settings/organization/api-keys"
    );
  }

  configDetails.push(`Target MCP URL: http://localhost:${config.mcpPort}/mcp`);
  configDetails.push(`Tunnel Health Port: ${config.tunnelHealthPort}`);

  items.push({
    status: configPass ? "PASS" : "WARN",
    title: "OpenAI Tunnel Configuration",
    details: configDetails,
  });

  // Check 2: Tunnel Client Binary Resolution
  let resolvedBinPath: string | undefined;
  try {
    const binInfo = await resolveBinary(config);
    resolvedBinPath = binInfo.binPath;
    items.push({
      status: "PASS",
      title: "OpenAI Tunnel Client Binary",
      details: [`Binary path: ${binInfo.binPath}`, `Version: ${binInfo.version}`],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    items.push({
      status: "WARN",
      title: "OpenAI Tunnel Client Binary",
      details: [msg],
    });
  }

  // Check 3: Tunnel Runtime / Preflight Status
  const probeRes = await probe(config.tunnelHealthPort, config);

  if (probeRes.status === "ready") {
    const readyDetails: string[] = [
      `Status: Ready (response: ${probeRes.readyzBody || "200 ready"})`,
      `Health URL: ${probeRes.healthUrl}`,
      `Admin UI: ${probeRes.healthUrl}/ui`,
    ];
    if (probeRes.tunnelId) {
      readyDetails.push(`Bound Tunnel ID: ${probeRes.tunnelId}`);
    }
    if (probeRes.mcpServerUrl) {
      readyDetails.push(`Bound MCP URL: ${probeRes.mcpServerUrl}`);
    }
    if (probeRes.healthDetails?.components?.["control-plane"]) {
      const cp = probeRes.healthDetails.components["control-plane"];
      readyDetails.push(
        `Control-plane component status: ${cp.status ?? "unknown"} (${cp.state ?? "polling"})`
      );
    }

    items.push({
      status: "PASS",
      title: "OpenAI Secure MCP Tunnel Readiness",
      details: readyDetails,
    });
  } else if (probeRes.status === "starting") {
    items.push({
      status: "WARN",
      title: "OpenAI Secure MCP Tunnel Readiness",
      details: [
        "tunnel-client process is live but not yet ready.",
        probeRes.detail ?? "Probe in progress",
      ],
    });
  } else if (probeRes.status === "port-occupied" || probeRes.status === "misconfigured-instance") {
    items.push({
      status: "FAIL",
      title: "Tunnel Health Port Conflict / Misconfiguration",
      details: [probeRes.detail ?? `Port ${config.tunnelHealthPort} is occupied`],
    });
  } else {
    // Port is free (unreachable). If binary and config are present, run optional doctor preflight
    if (resolvedBinPath && config.tunnelId && config.hasTunnelApiKey) {
      try {
        const preflight = await preflightDoctor(resolvedBinPath, config);
        if (preflight.supported) {
          items.push({
            status: preflight.result === "pass" ? "PASS" : "WARN",
            title: "Tunnel Client Preflight Diagnostics (tunnel-client doctor)",
            details: [
              preflight.summary ?? "Doctor completed.",
              `Port ${config.tunnelHealthPort} is free and ready for startup.`,
            ],
          });
        } else {
          items.push({
            status: "PASS",
            title: "Tunnel Client Preflight",
            details: [
              preflight.summary ?? "Doctor check not supported by this binary flavor.",
              `Port ${config.tunnelHealthPort} is free and ready for startup.`,
            ],
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        items.push({
          status: "WARN",
          title: "Tunnel Client Preflight",
          details: [`Preflight execution notice: ${msg}`],
        });
      }
    } else {
      items.push({
        status: "PASS",
        title: "Tunnel Health Port Availability",
        details: [
          `Port ${config.tunnelHealthPort} is free.`,
          `Target endpoint: http://127.0.0.1:${config.tunnelHealthPort}/readyz`,
        ],
      });
    }
  }

  // Check 4: Tunnel Process Ownership State
  const state = readState();
  if (state?.tunnel) {
    items.push({
      status: "PASS",
      title: "Tunnel Process Ownership State",
      details: [
        `Managed by openai-firecrawl: ${state.tunnel.owned ? "YES (owned)" : "NO (external)"}`,
        `Recorded PID: ${state.tunnel.pid ?? "(none)"}`,
        `Health URL: ${state.tunnel.healthUrl}`,
        `Tunnel ID: ${state.tunnel.tunnelId}`,
        `Last updated: ${state.updatedAt}`,
      ],
    });
  } else {
    items.push({
      status: "PASS",
      title: "Tunnel Process Ownership State",
      details: ["No active local tunnel runtime state recorded."],
    });
  }

  return items;
}
