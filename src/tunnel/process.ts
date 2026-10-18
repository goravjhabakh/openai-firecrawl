import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config/index.js";
import { type CommandResult, runCommand } from "../shared/exec.js";
import { getDefaultStateDir } from "../shared/state.js";

export class TunnelProcessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TunnelProcessError";
  }
}

export interface TunnelBinaryResolution {
  readonly binPath: string;
  readonly version: string;
}

export interface SpawnTunnelProcessOptions {
  readonly config: AppConfig;
  readonly binPath: string;
  readonly env?: NodeJS.ProcessEnv | undefined;
}

export interface SpawnTunnelResult {
  readonly pid: number;
  readonly binPath: string;
}

export interface TunnelDoctorPreflightResult {
  readonly supported: boolean;
  readonly result?: "pass" | "fail" | undefined;
  readonly rawReport?: unknown | undefined;
  readonly summary?: string | undefined;
}

/**
 * Resolve the default user-level tunnel-client binary path on Windows:
 * %LOCALAPPDATA%\openai-firecrawl\bin\tunnel-client.exe
 */
export function getDefaultTunnelClientBinPath(env: NodeJS.ProcessEnv = process.env): string {
  const exeName = process.platform === "win32" ? "tunnel-client.exe" : "tunnel-client";
  return join(getDefaultStateDir(env), "bin", exeName);
}

/**
 * Resolve the tunnel-client binary on Windows.
 * Resolution precedence:
 * 1. Explicit config.tunnelClientBin (TUNNEL_CLIENT_BIN)
 * 2. User-level %LOCALAPPDATA%\openai-firecrawl\bin\tunnel-client.exe
 * 3. tunnel-client.exe on PATH (via where.exe on Windows, which on POSIX)
 */
export async function resolveTunnelClientBinary(
  config: Pick<AppConfig, "tunnelClientBin">,
  exec: typeof runCommand = runCommand,
  env: NodeJS.ProcessEnv = process.env
): Promise<TunnelBinaryResolution> {
  const candidates: string[] = [];

  if (config.tunnelClientBin) {
    candidates.push(config.tunnelClientBin);
  }

  // User-level bin directory (%LOCALAPPDATA%\openai-firecrawl\bin\tunnel-client.exe)
  const localAppDataBin = getDefaultTunnelClientBinPath(env);
  candidates.push(localAppDataBin);

  // PATH resolution via where.exe (Windows) or which (Unix)
  if (process.platform === "win32") {
    const whereRes = await exec("where.exe", ["tunnel-client"]);
    if (whereRes.exitCode === 0) {
      const lines = whereRes.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (lines[0]) {
        candidates.push(lines[0]);
      }
    }
  } else {
    const whichRes = await exec("which", ["tunnel-client"]);
    if (whichRes.exitCode === 0 && whichRes.stdout.trim()) {
      candidates.push(whichRes.stdout.trim());
    }
  }

  let foundBin: string | undefined;
  for (const c of candidates) {
    if (existsSync(c)) {
      foundBin = c;
      break;
    }
  }

  if (!foundBin) {
    throw new TunnelProcessError(
      `OpenAI "tunnel-client" binary was not found. Please download "tunnel-client-windows-amd64.zip" from Platform settings (https://platform.openai.com/settings/organization/tunnels) or GitHub (https://github.com/openai/tunnel-client/releases/latest), place "tunnel-client.exe" on PATH or at "${localAppDataBin}", or configure TUNNEL_CLIENT_BIN in your config.`
    );
  }

  // Run --version to verify the binary executes and capture version
  const versionRes = await exec(foundBin, ["--version"]);
  if (versionRes.exitCode !== 0) {
    throw new TunnelProcessError(
      `Failed to execute tunnel-client binary at "${foundBin}" (--version returned exit code ${versionRes.exitCode}): ${versionRes.stderr}`
    );
  }

  const versionText = (versionRes.stdout.trim() || versionRes.stderr.trim() || "unknown")
    .split(/\r?\n/)[0]
    ?.trim();

  return {
    binPath: foundBin,
    version: versionText ?? "unknown",
  };
}

/**
 * Run optional preflight check using `tunnel-client doctor --json`.
 * If the installed binary is the narrow runtime flavor (which lacks the doctor command),
 * this falls back gracefully with supported: false.
 */
export async function runTunnelClientPreflight(
  binPath: string,
  config: AppConfig,
  exec: typeof runCommand = runCommand
): Promise<TunnelDoctorPreflightResult> {
  const mcpUrl = `http://localhost:${config.mcpPort}/mcp`;
  const healthAddr = `127.0.0.1:${config.tunnelHealthPort}`;

  const args = [
    "doctor",
    "--json",
    "--control-plane.tunnel-id",
    config.tunnelId ?? "",
    "--mcp.server-url",
    mcpUrl,
    "--health.listen-addr",
    healthAddr,
  ];

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CONTROL_PLANE_API_KEY: process.env.CONTROL_PLANE_API_KEY || process.env.OPENAI_API_KEY || "",
  };

  const res = await exec(binPath, args, { env });

  // If binary doesn't support "doctor" subcommand (e.g. narrow tunnel-client-runtime), exitCode may be 1 or 2 with unknown command
  if (
    res.stderr.toLowerCase().includes("unknown command") ||
    res.stdout.toLowerCase().includes("unknown command")
  ) {
    return {
      supported: false,
      summary: "Installed binary does not support 'doctor' command (narrow runtime flavor).",
    };
  }

  try {
    const parsed = JSON.parse(res.stdout) as {
      result?: string;
      failed_checks?: string[];
      checks?: Array<{ id?: string; status?: string; summary?: string }>;
    };

    const isPass = parsed.result === "pass";
    const summary = isPass
      ? "All tunnel-client local preflight checks passed."
      : `Preflight checks reported issues: ${(parsed.failed_checks ?? []).join(", ") || "Failed"}`;

    return {
      supported: true,
      result: isPass ? "pass" : "fail",
      rawReport: parsed,
      summary,
    };
  } catch {
    // If output is not JSON, check exitCode
    return {
      supported: true,
      result: res.exitCode === 0 ? "pass" : "fail",
      summary: res.exitCode === 0 ? "Doctor preflight passed." : res.stderr || res.stdout,
    };
  }
}

/**
 * Spawn the official tunnel-client process in the background.
 * Command args strictly exclude secrets and remote UI access.
 */
export function spawnTunnelProcess(options: SpawnTunnelProcessOptions): SpawnTunnelResult {
  const { config, binPath } = options;

  if (!config.tunnelId) {
    throw new TunnelProcessError("Cannot spawn tunnel-client: tunnelId is undefined.");
  }

  const mcpUrl = `http://localhost:${config.mcpPort}/mcp`;
  const healthAddr = `127.0.0.1:${config.tunnelHealthPort}`;

  const childArgs = [
    "run",
    "--control-plane.tunnel-id",
    config.tunnelId,
    "--mcp.server-url",
    mcpUrl,
    "--health.listen-addr",
    healthAddr,
    "--log.level",
    "info",
  ];

  // Secrets are passed strictly through the child process environment.
  // On Windows, tunnel-client has an internal Codex bridge MVP in its admin UI module that, by default,
  // spawns `codex app-server` via `cmd.exe /c codex app-server`. If npm's `codex.cmd` wrapper is installed on PATH,
  // cmd.exe allocates an interactive console window under Windows Terminal / conhost.
  // Supplying `TUNNEL_CLIENT_CODEX_APP_SERVER_CMD: "disabled"` suppresses this child shell spawn in background daemon mode.
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    CONTROL_PLANE_API_KEY: process.env.CONTROL_PLANE_API_KEY || process.env.OPENAI_API_KEY || "",
    ...(process.platform === "win32" && !process.env.TUNNEL_CLIENT_CODEX_APP_SERVER_CMD
      ? { TUNNEL_CLIENT_CODEX_APP_SERVER_CMD: "disabled" }
      : {}),
  };

  const child = spawn(binPath, childArgs, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: childEnv,
  });

  const pid = child.pid;
  if (!pid) {
    throw new TunnelProcessError("Failed to spawn tunnel-client: child.pid is undefined.");
  }

  child.unref();

  return {
    pid,
    binPath,
  };
}

/**
 * Check if a PID is alive and belongs to tunnel-client.
 * On Windows, inspects Win32_Process command line to prevent terminating reused PIDs.
 */
export async function isTunnelProcessAliveAndOwned(
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

      if (name.includes("tunnel-client") || cmd.includes("tunnel-client")) {
        return true;
      }

      // Reused PID
      return false;
    } catch {
      return true;
    }
  }

  return true;
}

/**
 * Terminate a verified tunnel-client process safely.
 */
export async function terminateTunnelProcess(
  pid: number,
  exec: typeof runCommand = runCommand
): Promise<boolean> {
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
