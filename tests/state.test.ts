import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearFirecrawlState,
  clearMcpState,
  clearRuntimeState,
  readRuntimeState,
  updateFirecrawlState,
  updateMcpState,
  writeRuntimeState,
} from "../src/shared/state.js";

const TEST_DIR = resolve(process.cwd(), "tests", "fixtures", "state");
const TEST_STATE_PATH = resolve(TEST_DIR, ".test-state.json");

describe("Runtime State Management", () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    if (existsSync(TEST_STATE_PATH)) {
      rmSync(TEST_STATE_PATH, { force: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_STATE_PATH)) {
      rmSync(TEST_STATE_PATH, { force: true });
    }
  });

  it("returns null when state file does not exist", () => {
    const state = readRuntimeState(TEST_STATE_PATH);
    expect(state).toBeNull();
  });

  it("writes and reads back valid state with firecrawl and mcp", () => {
    writeRuntimeState(
      {
        version: 1,
        updatedAt: "2026-10-18T10:00:00.000Z",
        firecrawl: {
          owned: true,
          apiUrl: "http://localhost:3002",
          firecrawlHome: "C:/path/to/firecrawl",
          startedAt: "2026-10-18T10:00:00.000Z",
        },
        mcp: {
          owned: true,
          pid: 1234,
          port: 3000,
          mcpUrl: "http://localhost:3000/mcp",
          firecrawlApiUrl: "http://localhost:3002",
          startedAt: "2026-10-18T10:00:05.000Z",
        },
      },
      TEST_STATE_PATH
    );

    const loaded = readRuntimeState(TEST_STATE_PATH);
    expect(loaded).toEqual({
      version: 1,
      updatedAt: "2026-10-18T10:00:00.000Z",
      firecrawl: {
        owned: true,
        apiUrl: "http://localhost:3002",
        firecrawlHome: "C:/path/to/firecrawl",
        startedAt: "2026-10-18T10:00:00.000Z",
      },
      mcp: {
        owned: true,
        pid: 1234,
        port: 3000,
        mcpUrl: "http://localhost:3000/mcp",
        firecrawlApiUrl: "http://localhost:3002",
        startedAt: "2026-10-18T10:00:05.000Z",
      },
    });
  });

  it("updates firecrawl and mcp state independently without overwriting the other", () => {
    updateFirecrawlState(
      {
        owned: true,
        apiUrl: "http://localhost:3002",
      },
      TEST_STATE_PATH
    );

    let state = readRuntimeState(TEST_STATE_PATH);
    expect(state?.firecrawl?.owned).toBe(true);
    expect(state?.mcp).toBeUndefined();

    updateMcpState(
      {
        owned: true,
        pid: 5678,
        port: 3000,
        mcpUrl: "http://localhost:3000/mcp",
        firecrawlApiUrl: "http://localhost:3002",
      },
      TEST_STATE_PATH
    );

    state = readRuntimeState(TEST_STATE_PATH);
    expect(state?.firecrawl?.owned).toBe(true);
    expect(state?.mcp?.pid).toBe(5678);

    // Clear MCP state only, firecrawl remains
    const mcpCleared = clearMcpState(TEST_STATE_PATH);
    expect(mcpCleared).toBe(true);
    state = readRuntimeState(TEST_STATE_PATH);
    expect(state?.mcp).toBeUndefined();
    expect(state?.firecrawl?.owned).toBe(true);
    expect(existsSync(TEST_STATE_PATH)).toBe(true);

    // Clear Firecrawl state now, file should be removed
    const firecrawlCleared = clearFirecrawlState(TEST_STATE_PATH);
    expect(firecrawlCleared).toBe(true);
    expect(existsSync(TEST_STATE_PATH)).toBe(false);
  });

  it("clears entire state file with clearRuntimeState", () => {
    updateMcpState(
      {
        owned: false,
        port: 3000,
        mcpUrl: "http://localhost:3000/mcp",
        firecrawlApiUrl: "http://localhost:3002",
      },
      TEST_STATE_PATH
    );

    expect(existsSync(TEST_STATE_PATH)).toBe(true);
    const removed = clearRuntimeState(TEST_STATE_PATH);
    expect(removed).toBe(true);
    expect(existsSync(TEST_STATE_PATH)).toBe(false);
  });
});
