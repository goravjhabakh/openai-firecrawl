import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface FirecrawlRuntimeState {
  readonly owned: boolean;
  readonly apiUrl: string;
  readonly firecrawlHome?: string | undefined;
  readonly startedAt?: string | undefined;
}

export interface McpRuntimeState {
  readonly owned: boolean;
  readonly pid?: number | undefined;
  readonly port: number;
  readonly mcpUrl: string;
  readonly firecrawlApiUrl: string;
  readonly startedAt?: string | undefined;
}

export interface TunnelRuntimeState {
  readonly owned: boolean;
  readonly pid?: number | undefined;
  readonly tunnelId: string;
  readonly mcpUrl: string;
  readonly healthPort: number;
  readonly healthUrl: string;
  readonly startedAt?: string | undefined;
}

export interface RuntimeState {
  readonly version: 1;
  readonly updatedAt: string;
  readonly firecrawl?: FirecrawlRuntimeState | undefined;
  readonly mcp?: McpRuntimeState | undefined;
  readonly tunnel?: TunnelRuntimeState | undefined;
}

const DEFAULT_STATE_FILE_NAME = ".openai-firecrawl-state.json";

export function getDefaultStateFilePath(): string {
  return resolve(process.cwd(), DEFAULT_STATE_FILE_NAME);
}

export function readRuntimeState(
  filePath: string = getDefaultStateFilePath()
): RuntimeState | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }
    const raw = readFileSync(filePath, "utf8");
    if (!raw.trim()) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<RuntimeState>;
    if (parsed && parsed.version === 1) {
      return parsed as RuntimeState;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeRuntimeState(
  state: RuntimeState,
  filePath: string = getDefaultStateFilePath()
): void {
  const content = JSON.stringify(state, null, 2);
  writeFileSync(filePath, content, "utf8");
}

export function updateFirecrawlState(
  firecrawl: FirecrawlRuntimeState | undefined,
  filePath: string = getDefaultStateFilePath()
): RuntimeState {
  const existing = readRuntimeState(filePath);
  const updated: RuntimeState = {
    version: 1,
    updatedAt: new Date().toISOString(),
    ...(existing?.mcp ? { mcp: existing.mcp } : {}),
    ...(existing?.tunnel ? { tunnel: existing.tunnel } : {}),
    ...(firecrawl !== undefined
      ? { firecrawl }
      : existing?.firecrawl
        ? { firecrawl: existing.firecrawl }
        : {}),
  };

  writeRuntimeState(updated, filePath);
  return updated;
}

export function updateMcpState(
  mcp: McpRuntimeState | undefined,
  filePath: string = getDefaultStateFilePath()
): RuntimeState {
  const existing = readRuntimeState(filePath);
  const updated: RuntimeState = {
    version: 1,
    updatedAt: new Date().toISOString(),
    ...(existing?.firecrawl ? { firecrawl: existing.firecrawl } : {}),
    ...(existing?.tunnel ? { tunnel: existing.tunnel } : {}),
    ...(mcp !== undefined ? { mcp } : existing?.mcp ? { mcp: existing.mcp } : {}),
  };

  writeRuntimeState(updated, filePath);
  return updated;
}

export function updateTunnelState(
  tunnel: TunnelRuntimeState | undefined,
  filePath: string = getDefaultStateFilePath()
): RuntimeState {
  const existing = readRuntimeState(filePath);
  const updated: RuntimeState = {
    version: 1,
    updatedAt: new Date().toISOString(),
    ...(existing?.firecrawl ? { firecrawl: existing.firecrawl } : {}),
    ...(existing?.mcp ? { mcp: existing.mcp } : {}),
    ...(tunnel !== undefined ? { tunnel } : existing?.tunnel ? { tunnel: existing.tunnel } : {}),
  };

  writeRuntimeState(updated, filePath);
  return updated;
}

export function clearFirecrawlState(filePath: string = getDefaultStateFilePath()): boolean {
  const existing = readRuntimeState(filePath);
  if (!existing) {
    return false;
  }

  if (existing.mcp || existing.tunnel) {
    const updated: RuntimeState = {
      version: 1,
      updatedAt: new Date().toISOString(),
      ...(existing.mcp ? { mcp: existing.mcp } : {}),
      ...(existing.tunnel ? { tunnel: existing.tunnel } : {}),
    };
    writeRuntimeState(updated, filePath);
    return true;
  }

  return clearRuntimeState(filePath);
}

export function clearMcpState(filePath: string = getDefaultStateFilePath()): boolean {
  const existing = readRuntimeState(filePath);
  if (!existing) {
    return false;
  }

  if (existing.firecrawl || existing.tunnel) {
    const updated: RuntimeState = {
      version: 1,
      updatedAt: new Date().toISOString(),
      ...(existing.firecrawl ? { firecrawl: existing.firecrawl } : {}),
      ...(existing.tunnel ? { tunnel: existing.tunnel } : {}),
    };
    writeRuntimeState(updated, filePath);
    return true;
  }

  return clearRuntimeState(filePath);
}

export function clearTunnelState(filePath: string = getDefaultStateFilePath()): boolean {
  const existing = readRuntimeState(filePath);
  if (!existing) {
    return false;
  }

  if (existing.firecrawl || existing.mcp) {
    const updated: RuntimeState = {
      version: 1,
      updatedAt: new Date().toISOString(),
      ...(existing.firecrawl ? { firecrawl: existing.firecrawl } : {}),
      ...(existing.mcp ? { mcp: existing.mcp } : {}),
    };
    writeRuntimeState(updated, filePath);
    return true;
  }

  return clearRuntimeState(filePath);
}

export function clearRuntimeState(filePath: string = getDefaultStateFilePath()): boolean {
  try {
    if (existsSync(filePath)) {
      rmSync(filePath, { force: true });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
