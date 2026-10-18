import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatHelpText, getPackageVersion, parseCliArgs, runCli } from "../src/cli.js";
import { initConfigFile, runInitCommand } from "../src/cli/init.js";
import { CONFIG_TEMPLATE } from "../src/config/index.js";
import { resolveFirecrawlMcpEntry } from "../src/mcp/process.js";
import { runCommand } from "../src/shared/exec.js";

const TEST_DIR = resolve(process.cwd(), "tests", "fixtures", "cli");
const TEST_CONFIG_PATH = resolve(TEST_DIR, "openai-firecrawl", ".env");

describe("CLI Argument Parsing", () => {
  it("parses init, start, doctor, and stop commands", () => {
    expect(parseCliArgs(["init"])).toEqual({ kind: "init" });
    expect(parseCliArgs(["start"])).toEqual({ kind: "start" });
    expect(parseCliArgs(["doctor"])).toEqual({ kind: "doctor" });
    expect(parseCliArgs(["stop"])).toEqual({ kind: "stop" });
  });

  it("parses --version and -v", () => {
    expect(parseCliArgs(["--version"])).toEqual({ kind: "version" });
    expect(parseCliArgs(["-v"])).toEqual({ kind: "version" });
  });

  it("parses --help, -h, and empty arguments as help", () => {
    expect(parseCliArgs([])).toEqual({ kind: "help" });
    expect(parseCliArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["-h"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["start", "--help"])).toEqual({ kind: "help" });
  });

  it("rejects unknown commands and unexpected arguments", () => {
    expect(parseCliArgs(["unknown-cmd"])).toEqual({
      kind: "unknown",
      input: "unknown-cmd",
    });
    expect(parseCliArgs(["start", "--extra"])).toEqual({
      kind: "unknown",
      input: "start --extra",
    });
  });

  it("returns exit code 0 for --version and --help and 1 for unknown command", async () => {
    expect(await runCli(["--version"])).toBe(0);
    expect(await runCli(["--help"])).toBe(0);
    expect(await runCli(["nonexistent"])).toBe(1);
    expect(getPackageVersion()).toBe("1.1.0");
    expect(formatHelpText()).toContain("openai-firecrawl init");
  });
});

describe("openai-firecrawl init", () => {
  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("creates config directory and .env template when missing", async () => {
    const result = initConfigFile(TEST_CONFIG_PATH);

    expect(result.status).toBe("created");
    expect(result.configPath).toBe(TEST_CONFIG_PATH);
    expect(existsSync(TEST_CONFIG_PATH)).toBe(true);
    expect(readFileSync(TEST_CONFIG_PATH, "utf8")).toBe(CONFIG_TEMPLATE);
  });

  it("refuses to overwrite existing config file", async () => {
    mkdirSync(resolve(TEST_DIR, "openai-firecrawl"), { recursive: true });
    const customContent = "FIRECRAWL_API_URL=http://localhost:9999\n";
    writeFileSync(TEST_CONFIG_PATH, customContent, "utf8");

    const result = initConfigFile(TEST_CONFIG_PATH);
    expect(result.status).toBe("already-exists");
    expect(readFileSync(TEST_CONFIG_PATH, "utf8")).toBe(customContent);

    const exitCode = await runInitCommand(TEST_CONFIG_PATH);
    expect(exitCode).toBe(0);
    expect(readFileSync(TEST_CONFIG_PATH, "utf8")).toBe(customContent);
  });
});

describe("Global Package & Compiled CLI Independence", () => {
  it("resolves firecrawl-mcp regardless of current working directory", () => {
    const resolved = resolveFirecrawlMcpEntry();
    expect(existsSync(resolved.entryPath)).toBe(true);
    expect(resolved.version).toBe("3.30.3");
  });

  it("executes compiled dist/cli.js from outside the repository when built", async () => {
    const distCli = resolve(process.cwd(), "dist", "cli.js");
    if (!existsSync(distCli)) {
      return;
    }

    const resVersion = await runCommand(process.execPath, [distCli, "--version"], {
      cwd: tmpdir(),
    });
    expect(resVersion.exitCode).toBe(0);
    expect(resVersion.stdout.trim()).toBe("1.1.0");

    const resHelp = await runCommand(process.execPath, [distCli, "--help"], {
      cwd: tmpdir(),
    });
    expect(resHelp.exitCode).toBe(0);
    expect(resHelp.stdout).toContain("openai-firecrawl init");
  });
});
