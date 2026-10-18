import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearFirecrawlState,
  clearMcpState,
  clearRuntimeState,
  clearTunnelState,
  getDefaultStateDir,
  getDefaultStateFilePath,
  readRuntimeState,
  updateFirecrawlState,
  updateMcpState,
  updateTunnelState,
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

  it("writes and reads back valid state with firecrawl, mcp, and tunnel", () => {
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
        tunnel: {
          owned: true,
          pid: 5678,
          tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
          mcpUrl: "http://localhost:3000/mcp",
          healthPort: 8080,
          healthUrl: "http://127.0.0.1:8080",
          startedAt: "2026-10-18T10:00:10.000Z",
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
      tunnel: {
        owned: true,
        pid: 5678,
        tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
        mcpUrl: "http://localhost:3000/mcp",
        healthPort: 8080,
        healthUrl: "http://127.0.0.1:8080",
        startedAt: "2026-10-18T10:00:10.000Z",
      },
    });
  });

  it("updates firecrawl, mcp, and tunnel state independently without overwriting others", () => {
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
    expect(state?.tunnel).toBeUndefined();

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

    updateTunnelState(
      {
        owned: true,
        pid: 9999,
        tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
        mcpUrl: "http://localhost:3000/mcp",
        healthPort: 8080,
        healthUrl: "http://127.0.0.1:8080",
      },
      TEST_STATE_PATH
    );

    state = readRuntimeState(TEST_STATE_PATH);
    expect(state?.firecrawl?.owned).toBe(true);
    expect(state?.mcp?.pid).toBe(5678);
    expect(state?.tunnel?.pid).toBe(9999);

    // Clear Tunnel state only, firecrawl and mcp remain
    const tunnelCleared = clearTunnelState(TEST_STATE_PATH);
    expect(tunnelCleared).toBe(true);
    state = readRuntimeState(TEST_STATE_PATH);
    expect(state?.tunnel).toBeUndefined();
    expect(state?.mcp?.pid).toBe(5678);
    expect(state?.firecrawl?.owned).toBe(true);

    // Clear MCP state, firecrawl remains
    const mcpCleared = clearMcpState(TEST_STATE_PATH);
    expect(mcpCleared).toBe(true);
    state = readRuntimeState(TEST_STATE_PATH);
    expect(state?.mcp).toBeUndefined();
    expect(state?.firecrawl?.owned).toBe(true);

    // Clear Firecrawl state now, file should be removed
    const firecrawlCleared = clearFirecrawlState(TEST_STATE_PATH);
    expect(firecrawlCleared).toBe(true);
    expect(existsSync(TEST_STATE_PATH)).toBe(false);
  });

  it("clears entire state file with clearRuntimeState", () => {
    updateTunnelState(
      {
        owned: false,
        tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
        mcpUrl: "http://localhost:3000/mcp",
        healthPort: 8080,
        healthUrl: "http://127.0.0.1:8080",
      },
      TEST_STATE_PATH
    );

    expect(existsSync(TEST_STATE_PATH)).toBe(true);
    const removed = clearRuntimeState(TEST_STATE_PATH);
    expect(removed).toBe(true);
    expect(existsSync(TEST_STATE_PATH)).toBe(false);
  });

  it("resolves user-level state path under LOCALAPPDATA", () => {
    const dir = getDefaultStateDir({ LOCALAPPDATA: "C:\\Users\\TestUser\\AppData\\Local" });
    const file = getDefaultStateFilePath({ LOCALAPPDATA: "C:\\Users\\TestUser\\AppData\\Local" });

    expect(dir).toBe(join("C:\\Users\\TestUser\\AppData\\Local", "openai-firecrawl"));
    expect(file).toBe(
      join("C:\\Users\\TestUser\\AppData\\Local", "openai-firecrawl", "state.json")
    );
  });

  it("automatically creates missing parent directories when writing state", () => {
    const nestedStatePath = resolve(TEST_DIR, "nested-dir", "sub", "state.json");
    if (existsSync(resolve(TEST_DIR, "nested-dir"))) {
      rmSync(resolve(TEST_DIR, "nested-dir"), { recursive: true, force: true });
    }

    writeRuntimeState(
      {
        version: 1,
        updatedAt: "2026-10-18T10:00:00.000Z",
      },
      nestedStatePath
    );

    expect(existsSync(nestedStatePath)).toBe(true);
    rmSync(resolve(TEST_DIR, "nested-dir"), { recursive: true, force: true });
  });
});
