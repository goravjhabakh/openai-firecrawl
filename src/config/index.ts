import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface AppConfig {
  readonly firecrawlApiUrl: string;
  readonly firecrawlHome: string | undefined;
  readonly mcpPort: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const DEFAULT_FIRECRAWL_API_URL = "http://localhost:3002";
const DEFAULT_MCP_PORT = 3000;

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

  return {
    firecrawlApiUrl,
    firecrawlHome,
    mcpPort,
  };
}

export function loadConfig(envPath = resolve(process.cwd(), ".env")): AppConfig {
  if (existsSync(envPath) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envPath);
  }

  return parseConfig(process.env);
}
