import type { AppConfig } from "../config/index.js";
import { type CommandResult, runCommand } from "../shared/exec.js";

export type TunnelProbeStatus =
  | "ready"
  | "starting"
  | "misconfigured-instance"
  | "port-occupied"
  | "unreachable";

export interface TunnelComponentSnapshot {
  readonly status?: string | undefined;
  readonly state?: string | undefined;
  readonly reason_code?: string | undefined;
  readonly observed_at?: string | undefined;
  readonly details?: Record<string, unknown> | undefined;
}

export interface TunnelHealthDetails {
  readonly schema_version?: number | undefined;
  readonly live?: boolean | undefined;
  readonly ready?: boolean | undefined;
  readonly runtime?:
    | {
        readonly instance_id?: string | undefined;
        readonly version?: string | undefined;
        readonly flavor?: string | undefined;
      }
    | undefined;
  readonly components?: Record<string, TunnelComponentSnapshot> | undefined;
}

export interface TunnelApiStatus {
  readonly version?: string | undefined;
  readonly client_instance_id?: string | undefined;
  readonly control_plane_tunnel_id?: string | undefined;
  readonly mcp_server_url?: string | undefined;
}

export interface TunnelProbeResult {
  readonly status: TunnelProbeStatus;
  readonly healthPort: number;
  readonly healthUrl: string;
  readonly readyzStatus?: number | undefined;
  readonly healthzStatus?: number | undefined;
  readonly readyzBody?: string | undefined;
  readonly version?: string | undefined;
  readonly tunnelId?: string | undefined;
  readonly mcpServerUrl?: string | undefined;
  readonly healthDetails?: TunnelHealthDetails | undefined;
  readonly detail?: string | undefined;
  readonly error?: string | undefined;
}

export interface WaitForTunnelReadyOptions {
  readonly timeoutMs?: number | undefined;
  readonly intervalMs?: number | undefined;
  readonly probe?: (healthPort: number, config: AppConfig) => Promise<TunnelProbeResult>;
  readonly isChildAlive?: () => boolean | Promise<boolean>;
}

export class TunnelHealthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TunnelHealthError";
  }
}

/**
 * Probe loopback health endpoints of tunnel-client.
 *
 * Authoritative readiness gate:
 * - GET http://127.0.0.1:<healthPort>/readyz (200 = ready, 503 = starting / probe pending)
 *
 * Supporting / diagnostic endpoints:
 * - GET http://127.0.0.1:<healthPort>/healthz (200 live = process is running)
 * - GET http://127.0.0.1:<healthPort>/health?details=true (schema_version 1, component details)
 * - GET http://127.0.0.1:<healthPort>/api/status (optional extra metadata when full binary is present)
 */
export async function probeTunnelReadiness(
  healthPort: number,
  config: Pick<AppConfig, "tunnelId" | "mcpPort">,
  fetchFn: typeof fetch = fetch
): Promise<TunnelProbeResult> {
  const baseHealthUrl = `http://127.0.0.1:${healthPort}`;
  const readyzUrl = `${baseHealthUrl}/readyz`;
  const healthzUrl = `${baseHealthUrl}/healthz`;
  const healthDetailsUrl = `${baseHealthUrl}/health?details=true`;
  const apiStatusUrl = `${baseHealthUrl}/api/status`;

  // 1. First probe /healthz for liveness and server signature
  let healthzStatus: number | undefined;
  let healthzBody = "";
  try {
    const res = await fetchFn(healthzUrl, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    healthzStatus = res.status;
    healthzBody = (await res.text().catch(() => "")).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: "unreachable",
      healthPort,
      healthUrl: baseHealthUrl,
      error: msg,
      detail: `Port ${healthPort} is free (no service responding): ${msg}`,
    };
  }

  // 2. Fetch /health?details=true for component diagnosis and binary flavor compatibility
  let healthDetails: TunnelHealthDetails | undefined;
  let isVerifiedTunnelClient = false;

  try {
    const res = await fetchFn(healthDetailsUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(2000),
    });
    if (res.status === 200) {
      const parsed = (await res.json()) as TunnelHealthDetails;
      if (parsed && parsed.schema_version === 1 && typeof parsed.live === "boolean") {
        healthDetails = parsed;
        isVerifiedTunnelClient = true;
      }
    }
  } catch {
    // Narrow or older binaries might return 404 for /health?details=true
  }

  // Fallback: If /healthz responded with "live" or HTTP 200, check if /api/status responds
  let apiStatus: TunnelApiStatus | undefined;
  try {
    const res = await fetchFn(apiStatusUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(2000),
    });
    if (res.status === 200) {
      const parsed = (await res.json()) as TunnelApiStatus;
      if (parsed && typeof parsed === "object") {
        apiStatus = parsed;
        isVerifiedTunnelClient = true;
      }
    }
  } catch {
    // /api/status is optional
  }

  // If healthz responded but neither /health nor /api/status confirmed tunnel-client,
  // check healthz text (tunnel-client outputs "live" on /healthz)
  if (!isVerifiedTunnelClient && (healthzBody.includes("live") || healthzStatus === 200)) {
    // Check if /readyz responds with text containing "ready" or "oauth" or "mcp"
    try {
      const testReadyz = await fetchFn(readyzUrl, {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });
      const txt = (await testReadyz.text().catch(() => "")).toLowerCase();
      if (txt.includes("ready") || txt.includes("mcp") || txt.includes("oauth")) {
        isVerifiedTunnelClient = true;
      }
    } catch {
      // not tunnel-client
    }
  }

  if (!isVerifiedTunnelClient) {
    return {
      status: "port-occupied",
      healthPort,
      healthUrl: baseHealthUrl,
      healthzStatus,
      detail: `Port ${healthPort} responded to HTTP, but does not match the OpenAI tunnel-client health contract.`,
    };
  }

  // Check for misconfigured existing instance if metadata is available from /api/status
  const expectedTunnelId = config.tunnelId;
  const expectedMcpUrl = `http://localhost:${config.mcpPort}/mcp`;

  if (apiStatus?.control_plane_tunnel_id && expectedTunnelId) {
    if (apiStatus.control_plane_tunnel_id !== expectedTunnelId) {
      return {
        status: "misconfigured-instance",
        healthPort,
        healthUrl: baseHealthUrl,
        tunnelId: apiStatus.control_plane_tunnel_id,
        mcpServerUrl: apiStatus.mcp_server_url,
        version: apiStatus.version,
        detail: `tunnel-client on port ${healthPort} is running for tunnel "${apiStatus.control_plane_tunnel_id}", but expected "${expectedTunnelId}".`,
      };
    }
  }

  if (apiStatus?.mcp_server_url) {
    const normActual = apiStatus.mcp_server_url.replace(/\/+$/, "");
    const normExpected = expectedMcpUrl.replace(/\/+$/, "");
    if (
      normActual !== normExpected &&
      !normActual.includes(`localhost:${config.mcpPort}`) &&
      !normActual.includes(`127.0.0.1:${config.mcpPort}`)
    ) {
      return {
        status: "misconfigured-instance",
        healthPort,
        healthUrl: baseHealthUrl,
        tunnelId: apiStatus.control_plane_tunnel_id,
        mcpServerUrl: apiStatus.mcp_server_url,
        version: apiStatus.version,
        detail: `tunnel-client on port ${healthPort} is pointing to MCP URL "${apiStatus.mcp_server_url}", but expected "${expectedMcpUrl}".`,
      };
    }
  }

  // 3. Authoritative readiness gate: Probe /readyz
  let readyzStatus: number | undefined;
  let readyzBody = "";
  try {
    const res = await fetchFn(readyzUrl, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    readyzStatus = res.status;
    readyzBody = (await res.text().catch(() => "")).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: "starting",
      healthPort,
      healthUrl: baseHealthUrl,
      healthzStatus,
      healthDetails,
      tunnelId: apiStatus?.control_plane_tunnel_id,
      mcpServerUrl: apiStatus?.mcp_server_url,
      version: apiStatus?.version ?? healthDetails?.runtime?.version,
      error: msg,
      detail: `tunnel-client process is live on port ${healthPort}, but /readyz probe failed: ${msg}`,
    };
  }

  const resolvedVersion = apiStatus?.version ?? healthDetails?.runtime?.version;
  const resolvedTunnelId = apiStatus?.control_plane_tunnel_id;
  const resolvedMcpUrl = apiStatus?.mcp_server_url;

  if (readyzStatus === 200) {
    return {
      status: "ready",
      healthPort,
      healthUrl: baseHealthUrl,
      readyzStatus: 200,
      healthzStatus,
      readyzBody,
      version: resolvedVersion,
      tunnelId: resolvedTunnelId,
      mcpServerUrl: resolvedMcpUrl,
      healthDetails,
      detail: `OpenAI Secure MCP Tunnel is ready (response: "${readyzBody || "200 ready"}").`,
    };
  }

  // readyzStatus 503 or other: process is starting or gating on probe
  return {
    status: "starting",
    healthPort,
    healthUrl: baseHealthUrl,
    readyzStatus,
    healthzStatus,
    readyzBody,
    version: resolvedVersion,
    tunnelId: resolvedTunnelId,
    mcpServerUrl: resolvedMcpUrl,
    healthDetails,
    detail: `tunnel-client is starting (readyz returned HTTP ${readyzStatus}: "${readyzBody}").`,
  };
}

/**
 * Poll until OpenAI Secure MCP Tunnel is ready or bounded timeout expires.
 */
export async function waitForTunnelReady(
  healthPort: number,
  config: AppConfig,
  options: WaitForTunnelReadyOptions = {}
): Promise<TunnelProbeResult> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const intervalMs = options.intervalMs ?? 500;
  const probe = options.probe ?? probeTunnelReadiness;

  const startTime = Date.now();
  let lastResult: TunnelProbeResult | undefined;

  while (Date.now() - startTime < timeoutMs) {
    if (options.isChildAlive) {
      const alive = await options.isChildAlive();
      if (!alive) {
        throw new TunnelHealthError(
          "tunnel-client process terminated unexpectedly during startup."
        );
      }
    }

    lastResult = await probe(healthPort, config);

    if (lastResult.status === "ready") {
      return lastResult;
    }

    if (lastResult.status === "port-occupied" || lastResult.status === "misconfigured-instance") {
      throw new TunnelHealthError(
        lastResult.detail ?? `Tunnel port ${healthPort} is occupied or misconfigured.`
      );
    }

    const elapsed = Date.now() - startTime;
    if (elapsed + intervalMs >= timeoutMs) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const detail =
    lastResult?.detail || lastResult?.readyzBody || lastResult?.error || "Timeout exceeded";
  throw new TunnelHealthError(
    `Secure MCP Tunnel on port ${healthPort} did not become ready within ${Math.round(timeoutMs / 1000)} seconds. Detail: ${detail}`
  );
}
