import type { AppConfig } from "../config/index.js";
import {
  type RuntimeState,
  clearRuntimeState,
  readRuntimeState,
  updateFirecrawlState,
} from "../shared/state.js";
import {
  type ComposeContainerSummary,
  type ComposeFileValidationResult,
  type DockerAvailabilityResult,
  checkDockerAvailability,
  inspectComposeProject,
  startComposeProject,
  stopComposeProject,
  validateFirecrawlHome,
} from "./docker.js";
import {
  FirecrawlHealthError,
  type FirecrawlProbeResult,
  probeFirecrawlReadiness,
  waitForFirecrawlReady,
} from "./health.js";

export class FirecrawlLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirecrawlLifecycleError";
  }
}

export interface EnsureFirecrawlRunningResult {
  readonly status: "already-running" | "started" | "existing-containers-detected";
  readonly owned: boolean;
  readonly apiUrl: string;
  readonly firecrawlHome?: string | undefined;
  readonly detail: string;
}

export interface StopManagedFirecrawlResult {
  readonly action: "stopped" | "skipped-not-owned" | "skipped-no-state";
  readonly message: string;
  readonly firecrawlHome?: string | undefined;
}

export interface DoctorCheckItem {
  readonly status: "PASS" | "WARN" | "FAIL";
  readonly title: string;
  readonly details: readonly string[];
}

export interface DoctorReport {
  readonly success: boolean;
  readonly items: readonly DoctorCheckItem[];
}

export interface LifecycleDependencies {
  readonly probe?: (apiUrl: string) => Promise<FirecrawlProbeResult>;
  readonly waitForReady?: (
    apiUrl: string,
    options?: { timeoutMs?: number; intervalMs?: number }
  ) => Promise<FirecrawlProbeResult>;
  readonly checkDocker?: () => Promise<DockerAvailabilityResult>;
  readonly validateHome?: (home: string | undefined) => ComposeFileValidationResult;
  readonly inspectCompose?: (
    home: string
  ) => Promise<{ hasExistingContainers: boolean; containers: readonly ComposeContainerSummary[] }>;
  readonly startCompose?: (
    home: string
  ) => Promise<{ exitCode: number; stderr: string; stdout: string }>;
  readonly stopCompose?: (
    home: string
  ) => Promise<{ exitCode: number; stderr: string; stdout: string }>;
  readonly readState?: () => RuntimeState | null;
  readonly updateState?: (firecrawl: {
    owned: boolean;
    apiUrl: string;
    firecrawlHome?: string | undefined;
    startedAt?: string | undefined;
  }) => RuntimeState;
  readonly clearState?: () => boolean;
}

export async function ensureFirecrawlRunning(
  config: AppConfig,
  deps: LifecycleDependencies = {}
): Promise<EnsureFirecrawlRunningResult> {
  const probe = deps.probe ?? probeFirecrawlReadiness;
  const waitForReady = deps.waitForReady ?? waitForFirecrawlReady;
  const checkDocker = deps.checkDocker ?? checkDockerAvailability;
  const validateHome = deps.validateHome ?? validateFirecrawlHome;
  const inspectCompose = deps.inspectCompose ?? inspectComposeProject;
  const startCompose = deps.startCompose ?? startComposeProject;
  const readState = deps.readState ?? readRuntimeState;
  const updateState = deps.updateState ?? updateFirecrawlState;

  // 1. Check if Firecrawl is already reachable and ready
  const probeRes = await probe(config.firecrawlApiUrl);

  if (probeRes.ready) {
    const existingState = readState();
    // If state exists, points to same URL, and was owned, retain ownership
    const isOwned =
      existingState?.firecrawl?.apiUrl === config.firecrawlApiUrl &&
      existingState.firecrawl.owned === true;

    updateState({
      owned: isOwned,
      apiUrl: config.firecrawlApiUrl,
      firecrawlHome: config.firecrawlHome ?? existingState?.firecrawl?.firecrawlHome,
      startedAt: existingState?.firecrawl?.startedAt ?? new Date().toISOString(),
    });

    return {
      status: "already-running",
      owned: isOwned,
      apiUrl: config.firecrawlApiUrl,
      firecrawlHome: config.firecrawlHome,
      detail: isOwned
        ? "Firecrawl is already running and managed by this project."
        : "Firecrawl is already running (external instance).",
    };
  }

  // 2. Firecrawl is NOT ready. Startup or waiting is required.
  // Validate FIRECRAWL_HOME first.
  const homeValidation = validateHome(config.firecrawlHome);
  if (!homeValidation.valid || !config.firecrawlHome) {
    throw new FirecrawlLifecycleError(
      `Firecrawl is not reachable at "${config.firecrawlApiUrl}", and automatic startup is not possible because ${homeValidation.error ?? "FIRECRAWL_HOME is not set"}. Please set FIRECRAWL_HOME in .env to your self-hosted Firecrawl directory or start Firecrawl manually.`
    );
  }

  // Validate Docker
  const dockerStatus = await checkDocker();
  if (!dockerStatus.available) {
    throw new FirecrawlLifecycleError(
      `Cannot start Firecrawl: ${dockerStatus.error ?? "Docker is unavailable."}. Please ensure Docker Desktop is running.`
    );
  }

  // Inspect existing Compose project containers in FIRECRAWL_HOME
  const composeInspection = await inspectCompose(config.firecrawlHome);

  if (composeInspection.hasExistingContainers) {
    // Containers exist. Do NOT claim ownership.
    // They may be booting or in an unhealthy state.
    updateState({
      owned: false,
      apiUrl: config.firecrawlApiUrl,
      firecrawlHome: config.firecrawlHome,
      startedAt: new Date().toISOString(),
    });

    // Attempt to wait for readiness in case containers are starting up
    try {
      await waitForReady(config.firecrawlApiUrl, { timeoutMs: 15_000, intervalMs: 2_000 });
      return {
        status: "existing-containers-detected",
        owned: false,
        apiUrl: config.firecrawlApiUrl,
        firecrawlHome: config.firecrawlHome,
        detail:
          "Found pre-existing Firecrawl containers; service became ready without modifying stack ownership.",
      };
    } catch {
      const containerSummary = composeInspection.containers
        .map((c) => `${c.service ?? c.name ?? "container"} (${c.status ?? c.state ?? "unknown"})`)
        .join(", ");
      throw new FirecrawlLifecycleError(
        `Pre-existing Firecrawl containers detected (${containerSummary}) at "${config.firecrawlHome}", but the API is not ready. Not starting a new stack or claiming ownership. Please check Docker logs: docker compose -f "${homeValidation.composeFilePath ?? "docker-compose.yaml"}" logs`
      );
    }
  }

  // 3. No existing containers. We start the stack and claim ownership.
  const startRes = await startCompose(config.firecrawlHome);
  if (startRes.exitCode !== 0) {
    throw new FirecrawlLifecycleError(
      `Failed to start Firecrawl with docker compose up -d: ${startRes.stderr.trim() || startRes.stdout.trim()}`
    );
  }

  // Record ownership immediately so cleanup is possible even if readiness times out
  updateState({
    owned: true,
    apiUrl: config.firecrawlApiUrl,
    firecrawlHome: config.firecrawlHome,
    startedAt: new Date().toISOString(),
  });

  // 4. Wait for readiness
  try {
    await waitForReady(config.firecrawlApiUrl, { timeoutMs: 90_000, intervalMs: 2_000 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new FirecrawlLifecycleError(
      `Firecrawl started with docker compose up -d, but readiness check failed: ${msg}. Run "pnpm stop" to tear down this instance or check container logs.`
    );
  }

  return {
    status: "started",
    owned: true,
    apiUrl: config.firecrawlApiUrl,
    firecrawlHome: config.firecrawlHome,
    detail: "Firecrawl Docker Compose stack was successfully started and verified ready.",
  };
}

export async function stopManagedFirecrawl(
  config: AppConfig,
  deps: LifecycleDependencies = {}
): Promise<StopManagedFirecrawlResult> {
  const readState = deps.readState ?? readRuntimeState;
  const clearState = deps.clearState ?? clearRuntimeState;
  const stopCompose = deps.stopCompose ?? stopComposeProject;
  const checkDocker = deps.checkDocker ?? checkDockerAvailability;

  const state = readState();

  if (!state || !state.firecrawl) {
    return {
      action: "skipped-no-state",
      message: "No managed Firecrawl state found. No processes were stopped.",
    };
  }

  if (!state.firecrawl.owned) {
    return {
      action: "skipped-not-owned",
      message: `Firecrawl at "${state.firecrawl.apiUrl}" was not started by this project. Leaving existing instance running.`,
      firecrawlHome: state.firecrawl.firecrawlHome,
    };
  }

  // Instance is owned by us
  const targetHome = state.firecrawl.firecrawlHome ?? config.firecrawlHome;
  if (!targetHome) {
    clearState();
    return {
      action: "skipped-not-owned",
      message: "Firecrawl was marked owned, but no FIRECRAWL_HOME is recorded. Cleared state file.",
    };
  }

  const dockerStatus = await checkDocker();
  if (!dockerStatus.available) {
    throw new FirecrawlLifecycleError(
      `Cannot stop Firecrawl: ${dockerStatus.error ?? "Docker is unavailable"}.`
    );
  }

  const stopRes = await stopCompose(targetHome);
  if (stopRes.exitCode !== 0) {
    throw new FirecrawlLifecycleError(
      `Failed to stop Firecrawl via docker compose down: ${stopRes.stderr.trim() || stopRes.stdout.trim()}`
    );
  }

  clearState();

  return {
    action: "stopped",
    message: `Stopped managed Firecrawl Docker Compose stack at "${targetHome}".`,
    firecrawlHome: targetHome,
  };
}

export async function runDoctorChecks(
  config: AppConfig,
  deps: LifecycleDependencies = {}
): Promise<DoctorReport> {
  const checkDocker = deps.checkDocker ?? checkDockerAvailability;
  const validateHome = deps.validateHome ?? validateFirecrawlHome;
  const probe = deps.probe ?? probeFirecrawlReadiness;
  const inspectCompose = deps.inspectCompose ?? inspectComposeProject;
  const readState = deps.readState ?? readRuntimeState;

  const items: DoctorCheckItem[] = [];
  let allPassed = true;

  // 1. Config Check
  items.push({
    status: "PASS",
    title: "Configuration",
    details: [
      `FIRECRAWL_API_URL: ${config.firecrawlApiUrl}`,
      `MCP_PORT: ${config.mcpPort}`,
      `FIRECRAWL_HOME: ${config.firecrawlHome ?? "(not set)"}`,
    ],
  });

  // 2. Docker Availability Check
  const dockerRes = await checkDocker();
  if (dockerRes.available) {
    items.push({
      status: "PASS",
      title: "Docker Environment",
      details: [
        `Docker Server: ${dockerRes.serverVersion ?? "available"}`,
        `Docker Compose: ${dockerRes.composeVersion ?? "available"}`,
      ],
    });
  } else {
    items.push({
      status: "WARN",
      title: "Docker Environment",
      details: [dockerRes.error ?? "Docker daemon or Compose CLI not responding."],
    });
  }

  // 3. Firecrawl Readiness Probe
  const probeRes = await probe(config.firecrawlApiUrl);
  if (probeRes.ready) {
    items.push({
      status: "PASS",
      title: "Firecrawl Reachability",
      details: [
        `Endpoint: ${probeRes.endpointTested}`,
        `Probe result: ${probeRes.detail ?? "Ready"}`,
      ],
    });
  } else {
    items.push({
      status: dockerRes.available && config.firecrawlHome ? "WARN" : "FAIL",
      title: "Firecrawl Reachability",
      details: [
        `Endpoint: ${config.firecrawlApiUrl}`,
        "Status: Not ready",
        probeRes.error ?? probeRes.detail ?? "Connection refused or non-Firecrawl response.",
      ],
    });
    if (!dockerRes.available || !config.firecrawlHome) {
      allPassed = false;
    }
  }

  // 4. FIRECRAWL_HOME & Compose Inspection
  if (config.firecrawlHome) {
    const homeRes = validateHome(config.firecrawlHome);
    if (homeRes.valid) {
      const composeDetails = [`Compose File: ${homeRes.composeFilePath}`];
      if (dockerRes.available) {
        const inspectRes = await inspectCompose(config.firecrawlHome);
        if (inspectRes.hasExistingContainers) {
          composeDetails.push(
            `Containers detected (${inspectRes.containers.length}): ${inspectRes.containers.map((c) => `${c.service ?? c.name} [${c.status ?? c.state}]`).join(", ")}`
          );
        } else {
          composeDetails.push("No active/existing containers detected for this Compose project.");
        }
      }
      items.push({
        status: "PASS",
        title: "Firecrawl Home & Compose Setup",
        details: composeDetails,
      });
    } else {
      const isCritical = !probeRes.ready;
      if (isCritical) {
        allPassed = false;
      }
      items.push({
        status: isCritical ? "FAIL" : "WARN",
        title: "Firecrawl Home & Compose Setup",
        details: [homeRes.error ?? "Invalid FIRECRAWL_HOME directory."],
      });
    }
  } else {
    items.push({
      status: probeRes.ready ? "PASS" : "WARN",
      title: "Firecrawl Home Setup",
      details: [
        "FIRECRAWL_HOME is not set.",
        probeRes.ready
          ? "External Firecrawl instance detected; FIRECRAWL_HOME is optional."
          : "FIRECRAWL_HOME is required to automatically start Firecrawl when not already running.",
      ],
    });
  }

  // 5. State / Process Ownership
  const state = readState();
  if (state?.firecrawl) {
    items.push({
      status: "PASS",
      title: "Process Ownership State",
      details: [
        `Managed by openai-firecrawl: ${state.firecrawl.owned ? "YES (owned)" : "NO (external)"}`,
        `Target API: ${state.firecrawl.apiUrl}`,
        `Recorded Home: ${state.firecrawl.firecrawlHome ?? "(none)"}`,
        `Last updated: ${state.updatedAt}`,
      ],
    });
  } else {
    items.push({
      status: "PASS",
      title: "Process Ownership State",
      details: ["No active local runtime state recorded."],
    });
  }

  return {
    success: allPassed,
    items,
  };
}
