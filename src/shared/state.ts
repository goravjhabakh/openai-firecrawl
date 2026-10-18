import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface FirecrawlRuntimeState {
  readonly owned: boolean;
  readonly apiUrl: string;
  readonly firecrawlHome?: string | undefined;
  readonly startedAt?: string | undefined;
}

export interface RuntimeState {
  readonly version: 1;
  readonly updatedAt: string;
  readonly firecrawl?: FirecrawlRuntimeState | undefined;
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
    ...(existing?.firecrawl ? { firecrawl: existing.firecrawl } : {}),
    ...(firecrawl !== undefined ? { firecrawl } : {}),
  };

  writeRuntimeState(updated, filePath);
  return updated;
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
