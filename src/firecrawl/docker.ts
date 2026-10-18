import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { type CommandResult, runCommand } from "../shared/exec.js";

export interface DockerAvailabilityResult {
  readonly available: boolean;
  readonly serverVersion?: string | undefined;
  readonly composeVersion?: string | undefined;
  readonly error?: string | undefined;
}

export interface ComposeFileValidationResult {
  readonly valid: boolean;
  readonly composeFilePath?: string | undefined;
  readonly error?: string | undefined;
}

export interface ComposeContainerSummary {
  readonly id?: string | undefined;
  readonly name?: string | undefined;
  readonly service?: string | undefined;
  readonly state?: string | undefined;
  readonly status?: string | undefined;
}

export interface ComposeProjectInspectionResult {
  readonly hasExistingContainers: boolean;
  readonly containers: readonly ComposeContainerSummary[];
  readonly rawOutput: string;
}

const COMPOSE_FILE_CANDIDATES = [
  "docker-compose.yaml",
  "docker-compose.yml",
  "compose.yaml",
  "compose.yml",
] as const;

export async function checkDockerAvailability(
  exec: typeof runCommand = runCommand
): Promise<DockerAvailabilityResult> {
  const versionRes = await exec("docker", ["version", "--format", "{{.Server.Version}}"]);
  if (versionRes.exitCode !== 0) {
    const detail =
      versionRes.stderr.trim() || versionRes.stdout.trim() || "Docker daemon not responding";
    return {
      available: false,
      error: `Docker is unavailable or Docker daemon is not running: ${detail}`,
    };
  }

  const composeRes = await exec("docker", ["compose", "version"]);
  if (composeRes.exitCode !== 0) {
    const detail =
      composeRes.stderr.trim() || composeRes.stdout.trim() || "Docker Compose not found";
    return {
      available: false,
      error: `Docker Compose is unavailable: ${detail}`,
    };
  }

  const serverVersion = versionRes.stdout.trim();
  const composeVersion = composeRes.stdout.trim();

  return {
    available: true,
    serverVersion,
    composeVersion,
  };
}

export function validateFirecrawlHome(
  firecrawlHome: string | undefined
): ComposeFileValidationResult {
  if (!firecrawlHome || firecrawlHome.trim().length === 0) {
    return {
      valid: false,
      error: "FIRECRAWL_HOME is not set.",
    };
  }

  const resolvedHome = resolve(firecrawlHome);

  if (!existsSync(resolvedHome)) {
    return {
      valid: false,
      error: `FIRECRAWL_HOME path does not exist: "${resolvedHome}".`,
    };
  }

  try {
    const stat = statSync(resolvedHome);
    if (!stat.isDirectory()) {
      return {
        valid: false,
        error: `FIRECRAWL_HOME is not a directory: "${resolvedHome}".`,
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      error: `Failed to inspect FIRECRAWL_HOME directory: ${msg}`,
    };
  }

  for (const candidate of COMPOSE_FILE_CANDIDATES) {
    const filePath = resolve(resolvedHome, candidate);
    if (existsSync(filePath)) {
      return {
        valid: true,
        composeFilePath: filePath,
      };
    }
  }

  return {
    valid: false,
    error: `No Docker Compose file (${COMPOSE_FILE_CANDIDATES.join(", ")}) found in "${resolvedHome}".`,
  };
}

export async function inspectComposeProject(
  firecrawlHome: string,
  exec: typeof runCommand = runCommand
): Promise<ComposeProjectInspectionResult> {
  const res = await exec("docker", ["compose", "ps", "--format", "json"], {
    cwd: firecrawlHome,
  });

  if (res.exitCode !== 0) {
    // If docker compose ps fails (e.g. invalid config or missing daemon), treat as no existing containers
    return {
      hasExistingContainers: false,
      containers: [],
      rawOutput: res.stderr || res.stdout,
    };
  }

  const lines = res.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const containers: ComposeContainerSummary[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        ID?: string;
        Name?: string;
        Service?: string;
        State?: string;
        Status?: string;
      };
      if (parsed && typeof parsed === "object") {
        containers.push({
          id: parsed.ID,
          name: parsed.Name,
          service: parsed.Service,
          state: parsed.State,
          status: parsed.Status,
        });
      }
    } catch {
      // Line might not be json (e.g. warning message or json array); handle json array if applicable
    }
  }

  // Also handle case where docker compose ps output is a single JSON array
  if (containers.length === 0 && res.stdout.trim().startsWith("[")) {
    try {
      const parsedArray = JSON.parse(res.stdout) as Array<{
        ID?: string;
        Name?: string;
        Service?: string;
        State?: string;
        Status?: string;
      }>;
      if (Array.isArray(parsedArray)) {
        for (const item of parsedArray) {
          containers.push({
            id: item.ID,
            name: item.Name,
            service: item.Service,
            state: item.State,
            status: item.Status,
          });
        }
      }
    } catch {
      // Ignore JSON parse errors
    }
  }

  return {
    hasExistingContainers: containers.length > 0,
    containers,
    rawOutput: res.stdout,
  };
}

export async function startComposeProject(
  firecrawlHome: string,
  exec: typeof runCommand = runCommand
): Promise<CommandResult> {
  return exec("docker", ["compose", "up", "-d"], { cwd: firecrawlHome });
}

export async function stopComposeProject(
  firecrawlHome: string,
  exec: typeof runCommand = runCommand
): Promise<CommandResult> {
  return exec("docker", ["compose", "down"], { cwd: firecrawlHome });
}
