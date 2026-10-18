import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";

export interface AppConfig {
  readonly firecrawlApiUrl: string;
  readonly firecrawlHome: string | undefined;
  readonly mcpPort: number;
  readonly tunnelId: string | undefined;
  readonly hasTunnelApiKey: boolean;
  readonly tunnelApiKeyEnvVar: "CONTROL_PLANE_API_KEY" | "OPENAI_API_KEY" | undefined;
  readonly tunnelClientBin: string | undefined;
  readonly tunnelHealthPort: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const DEFAULT_FIRECRAWL_API_URL = "http://localhost:3002";
const DEFAULT_MCP_PORT = 3000;
const DEFAULT_TUNNEL_HEALTH_PORT = 8080;

export const APP_DIR_NAME = "openai-firecrawl";
export const CONFIG_FILE_NAME = ".env";

export const CONFIG_TEMPLATE = `FIRECRAWL_API_URL=http://localhost:3002
FIRECRAWL_HOME=C:/path/to/firecrawl
MCP_PORT=3000

# OpenAI Secure MCP Tunnel
CONTROL_PLANE_TUNNEL_ID=
CONTROL_PLANE_API_KEY=

# Optional overrides:
# TUNNEL_CLIENT_BIN=C:/path/to/tunnel-client.exe
# TUNNEL_HEALTH_PORT=8080
`;

// Official OpenAI tunnel ID regex: tunnel_<32 lowercase letters or digits> or tunnel_<4-char-namespace>_<32 lowercase letters or digits>
const TUNNEL_ID_REGEX = /^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$/;

/**
 * Resolve the user-level configuration directory on Windows:
 * %APPDATA%\openai-firecrawl
 */
export function getDefaultConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const appData = env.APPDATA?.trim() || join(homedir(), "AppData", "Roaming");
  return join(appData, APP_DIR_NAME);
}

/**
 * Resolve the user-level configuration file path on Windows:
 * %APPDATA%\openai-firecrawl\.env
 */
export function getDefaultConfigFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getDefaultConfigDir(env), CONFIG_FILE_NAME);
}

export function parseConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawApiUrl = env.FIRECRAWL_API_URL?.trim() || DEFAULT_FIRECRAWL_API_URL;
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawApiUrl);
  } catch {
    throw new ConfigError(
      `Invalid FIRECRAWL_API_URL: "${rawApiUrl}". Expected a valid HTTP or HTTPS URL (e.g. "http://localhost:3002").`
    );
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new ConfigError(
      `Invalid FIRECRAWL_API_URL protocol: "${parsedUrl.protocol}". Must be "http:" or "https:".`
    );
  }

  // Normalize URL by removing trailing slash if present
  const pathname = parsedUrl.pathname.replace(/\/+$/, "");
  const firecrawlApiUrl = `${parsedUrl.origin}${pathname}`;

  const rawHome = env.FIRECRAWL_HOME?.trim();
  const firecrawlHome = rawHome && rawHome.length > 0 ? rawHome : undefined;

  const rawPort = env.MCP_PORT?.trim();
  let mcpPort = DEFAULT_MCP_PORT;

  if (rawPort !== undefined && rawPort.length > 0) {
    const parsedPort = Number(rawPort);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      throw new ConfigError(
        `Invalid MCP_PORT: "${rawPort}". Expected an integer between 1 and 65535.`
      );
    }
    mcpPort = parsedPort;
  }

  // Tunnel ID
  const rawTunnelId = env.CONTROL_PLANE_TUNNEL_ID?.trim();
  let tunnelId: string | undefined;
  if (rawTunnelId !== undefined && rawTunnelId.length > 0) {
    if (!TUNNEL_ID_REGEX.test(rawTunnelId)) {
      throw new ConfigError(
        `Invalid CONTROL_PLANE_TUNNEL_ID: "${rawTunnelId}". Expected format tunnel_<32 hex/alphanumeric> or tunnel_<4-char-namespace>_<32 hex/alphanumeric>.`
      );
    }
    tunnelId = rawTunnelId;
  }

  // Tunnel API key presence check (never stores raw secret)
  const hasControlPlaneKey = Boolean(env.CONTROL_PLANE_API_KEY?.trim());
  const hasOpenAiKey = Boolean(env.OPENAI_API_KEY?.trim());
  const hasTunnelApiKey = hasControlPlaneKey || hasOpenAiKey;
  const tunnelApiKeyEnvVar = hasControlPlaneKey
    ? "CONTROL_PLANE_API_KEY"
    : hasOpenAiKey
      ? "OPENAI_API_KEY"
      : undefined;

  // Tunnel Client Binary path override
  const rawClientBin = env.TUNNEL_CLIENT_BIN?.trim();
  const tunnelClientBin = rawClientBin && rawClientBin.length > 0 ? rawClientBin : undefined;

  // Tunnel Health Port
  const rawHealthPort = env.TUNNEL_HEALTH_PORT?.trim();
  let tunnelHealthPort = DEFAULT_TUNNEL_HEALTH_PORT;
  if (rawHealthPort !== undefined && rawHealthPort.length > 0) {
    const parsedHealthPort = Number(rawHealthPort);
    if (!Number.isInteger(parsedHealthPort) || parsedHealthPort < 1 || parsedHealthPort > 65535) {
      throw new ConfigError(
        `Invalid TUNNEL_HEALTH_PORT: "${rawHealthPort}". Expected an integer between 1 and 65535.`
      );
    }
    tunnelHealthPort = parsedHealthPort;
  }

  if (tunnelHealthPort === mcpPort) {
    throw new ConfigError(
      `TUNNEL_HEALTH_PORT (${tunnelHealthPort}) cannot be the same as MCP_PORT (${mcpPort}). Please use different ports.`
    );
  }

  return {
    firecrawlApiUrl,
    firecrawlHome,
    mcpPort,
    tunnelId,
    hasTunnelApiKey,
    tunnelApiKeyEnvVar,
    tunnelClientBin,
    tunnelHealthPort,
  };
}

/**
 * Load configuration with precedence:
 * 1. process environment (env parameter / process.env)
 * 2. global config file (%APPDATA%\openai-firecrawl\.env)
 * 3. built-in defaults
 *
 * When using the default process.env, values from the config file that are not already
 * set in process.env are also populated into process.env so child processes (e.g. tunnel-client)
 * inherit CONTROL_PLANE_API_KEY without storing raw secrets on AppConfig.
 */
export function loadConfig(
  envPath: string = getDefaultConfigFilePath(),
  env: NodeJS.ProcessEnv = process.env
): AppConfig {
  let fileEnv: NodeJS.ProcessEnv = {};

  if (existsSync(envPath)) {
    try {
      const raw = readFileSync(envPath, "utf8");
      fileEnv = parseEnv(raw);
    } catch {
      fileEnv = {};
    }
  }

  // Merge: fileEnv values are overridden by any variable explicitly defined in env
  const mergedEnv: NodeJS.ProcessEnv = { ...fileEnv };
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      mergedEnv[key] = value;
      if (env === process.env) {
        process.env[key] = value;
      }
    }
  }

  // Populate process.env for keys present only in the config file when loading for live CLI execution
  if (env === process.env) {
    for (const [key, value] of Object.entries(fileEnv)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }

  return parseConfig(mergedEnv);
}
