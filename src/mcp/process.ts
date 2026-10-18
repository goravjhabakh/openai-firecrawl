import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { AppConfig } from "../config/index.js";
import { type CommandResult, runCommand } from "../shared/exec.js";

export class McpProcessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpProcessError";
  }
}

export interface McpProcessResolution {
  readonly entryPath: string;
  readonly version: string;
}

export interface SpawnMcpProcessOptions {
  readonly config: AppConfig;
  readonly env?: NodeJS.ProcessEnv | undefined;
}

export interface SpawnMcpResult {
  readonly pid: number;
  readonly entryPath: string;
}

/**
 * Resolve the official firecrawl-mcp executable entry point.
 * Inspects package.json bin definition first ("firecrawl-mcp": "dist/index.js"),
 * then resolves the full file path relative to this package's installed location.
 */
export function resolveFirecrawlMcpEntry(baseDir?: string): McpProcessResolution {
  const require = baseDir
    ? createRequire(resolve(baseDir, "package.json"))
    : createRequire(import.meta.url);

  let pkgJsonPath: string;
  try {
    pkgJsonPath = require.resolve("firecrawl-mcp/package.json");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new McpProcessError(
      `Failed to resolve "firecrawl-mcp" package. Ensure dependencies are installed (pnpm install). Detail: ${msg}`
    );
  }

  try {
    const raw = readFileSync(pkgJsonPath, "utf8");
    const pkg = JSON.parse(raw) as {
      version?: string;
      bin?: string | Record<string, string>;
    };

    let binRelPath: string | undefined;
    if (typeof pkg.bin === "string") {
      binRelPath = pkg.bin;
    } else if (pkg.bin && typeof pkg.bin === "object") {
      binRelPath = pkg.bin["firecrawl-mcp"] ?? Object.values(pkg.bin)[0];
    }

    if (!binRelPath) {
      throw new McpProcessError(
        `"firecrawl-mcp" package.json at "${pkgJsonPath}" does not specify a valid "bin" entry.`
      );
    }

    const pkgDir = resolve(pkgJsonPath, "..");
    const entryPath = resolve(pkgDir, binRelPath);

    if (!existsSync(entryPath)) {
      throw new McpProcessError(
        `Resolved firecrawl-mcp bin entry does not exist at "${entryPath}".`
      );
    }

    return {
      entryPath,
      version: pkg.version ?? "unknown",
    };
  } catch (err) {
    if (err instanceof McpProcessError) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new McpProcessError(`Failed to read firecrawl-mcp package info: ${msg}`);
  }
}

/**
 * Spawn the official firecrawl-mcp server using direct Node.exe execution.
 * Avoids Windows .cmd/npx wrapper layers so child.pid is the true server process.
 */
export function spawnMcpProcess(
  options: SpawnMcpProcessOptions,
  resolveEntry: typeof resolveFirecrawlMcpEntry = resolveFirecrawlMcpEntry
): SpawnMcpResult {
  const { entryPath } = resolveEntry();

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    HTTP_STREAMABLE_SERVER: "true",
    PORT: String(options.config.mcpPort),
    HOST: "localhost",
    FIRECRAWL_API_URL: options.config.firecrawlApiUrl,
  };

  const child = spawn(process.execPath, [entryPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: childEnv,
  });

  const pid = child.pid;
  if (!pid) {
    throw new McpProcessError("Failed to spawn firecrawl-mcp process: child.pid is undefined.");
  }

  child.unref();

  return {
    pid,
    entryPath,
  };
}

/**
 * Check if a PID is alive and belongs to node / firecrawl-mcp.
 * On Windows, inspects Win32_Process command line to prevent killing reused PIDs.
 */
export async function isMcpProcessAliveAndOwned(
  pid: number,
  exec: typeof runCommand = runCommand
): Promise<boolean> {
  // 1. Basic alive check via signal 0
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }

  // 2. Windows-specific process identification via PowerShell CIM
  if (process.platform === "win32") {
    try {
      const res = await exec("powershell", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object -Property Name, CommandLine | ConvertTo-Json`,
      ]);

      if (res.exitCode !== 0 || !res.stdout.trim()) {
        return false;
      }

      const parsed = JSON.parse(res.stdout) as {
        Name?: string;
        CommandLine?: string;
      };

      const cmd = (parsed.CommandLine ?? "").toLowerCase();
      const name = (parsed.Name ?? "").toLowerCase();

      // Process must be node and mention firecrawl
      if (name.includes("node") && cmd.includes("firecrawl")) {
        return true;
      }

      // If the command line is node but doesn't mention firecrawl, PID was reused
      return false;
    } catch {
      // If CIM query fails for permissions/other reasons, return true since process.kill(pid, 0) was ok
      return true;
    }
  }

  return true;
}

/**
 * Terminate a verified MCP process safely.
 */
export async function terminateMcpProcess(
  pid: number,
  exec: typeof runCommand = runCommand
): Promise<boolean> {
  // Verify process alive before terminating
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }

  if (process.platform === "win32") {
    const res = await exec("taskkill", ["/PID", String(pid), "/T", "/F"]);
    return res.exitCode === 0;
  }

  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}
