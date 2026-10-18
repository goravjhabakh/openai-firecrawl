import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearRuntimeState,
  readRuntimeState,
  updateFirecrawlState,
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

  it("writes and reads back valid state", () => {
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
    });
  });

  it("handles corrupted or invalid JSON gracefully", () => {
    writeFileSync(TEST_STATE_PATH, "{ not valid json ...", "utf8");
    const loaded = readRuntimeState(TEST_STATE_PATH);
    expect(loaded).toBeNull();
  });

  it("handles state with unsupported version", () => {
    writeFileSync(
      TEST_STATE_PATH,
      JSON.stringify({ version: 99, updatedAt: "2026-10-18T10:00:00.000Z" }),
      "utf8"
    );
    const loaded = readRuntimeState(TEST_STATE_PATH);
    expect(loaded).toBeNull();
  });

  it("updates firecrawl state while preserving other data", () => {
    const updated = updateFirecrawlState(
      {
        owned: false,
        apiUrl: "http://localhost:3002",
      },
      TEST_STATE_PATH
    );

    expect(updated.version).toBe(1);
    expect(updated.firecrawl).toEqual({
      owned: false,
      apiUrl: "http://localhost:3002",
    });

    const read = readRuntimeState(TEST_STATE_PATH);
    expect(read?.firecrawl?.owned).toBe(false);
  });

  it("clears state file safely", () => {
    updateFirecrawlState(
      {
        owned: true,
        apiUrl: "http://localhost:3002",
      },
      TEST_STATE_PATH
    );

    expect(existsSync(TEST_STATE_PATH)).toBe(true);
    const removed = clearRuntimeState(TEST_STATE_PATH);
    expect(removed).toBe(true);
    expect(existsSync(TEST_STATE_PATH)).toBe(false);

    // Clearing non-existent file returns false without throwing
    const removedAgain = clearRuntimeState(TEST_STATE_PATH);
    expect(removedAgain).toBe(false);
  });
});
