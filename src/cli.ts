#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runDoctorCommand } from "./cli/doctor.js";
import { runInitCommand } from "./cli/init.js";
import { runStartCommand } from "./cli/start.js";
import { runStopCommand } from "./cli/stop.js";
import { getDefaultConfigFilePath } from "./config/index.js";
import { getDefaultStateFilePath } from "./shared/state.js";

export type CliCommand =
  | { readonly kind: "init" }
  | { readonly kind: "start" }
  | { readonly kind: "doctor" }
  | { readonly kind: "stop" }
  | { readonly kind: "version" }
  | { readonly kind: "help" }
  | { readonly kind: "unknown"; readonly input: string };

export function parseCliArgs(args: readonly string[]): CliCommand {
  const first = args[0]?.trim();

  if (!first || first === "--help" || first === "-h" || first === "help") {
    return { kind: "help" };
  }

  if (first === "--version" || first === "-v" || first === "version") {
    return { kind: "version" };
  }

  if (args.includes("--help") || args.includes("-h")) {
    return { kind: "help" };
  }

  if (args.length > 1) {
    return { kind: "unknown", input: args.join(" ") };
  }

  switch (first) {
    case "init":
      return { kind: "init" };
    case "start":
      return { kind: "start" };
    case "doctor":
      return { kind: "doctor" };
    case "stop":
      return { kind: "stop" };
    default:
      return { kind: "unknown", input: first };
  }
}

export function getPackageVersion(): string {
  try {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const pkgJsonPath = resolve(currentDir, "..", "package.json");
    const raw = readFileSync(pkgJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "1.1.0";
  } catch {
    return "1.1.0";
  }
}

export function formatHelpText(): string {
  const configPath = getDefaultConfigFilePath();
  const statePath = getDefaultStateFilePath();

  return [
    "openai-firecrawl — Connect ChatGPT to self-hosted Firecrawl via MCP and OpenAI Secure Tunnel",
    "",
    "Usage:",
    "  openai-firecrawl init",
    "  openai-firecrawl doctor",
    "  openai-firecrawl start",
    "  openai-firecrawl stop",
    "  openai-firecrawl --version",
    "  openai-firecrawl --help",
    "",
    "Commands:",
    "  init      Create the default user configuration file if missing",
    "  doctor    Run non-destructive diagnostics across Config, Docker, Firecrawl, MCP, and Tunnel",
    "  start     Start and verify Firecrawl, official firecrawl-mcp, and OpenAI tunnel-client",
    "  stop      Stop only the processes that were started by openai-firecrawl",
    "",
    "Options:",
    "  -v, --version   Print package version",
    "  -h, --help      Print this help message",
    "",
    "Paths:",
    `  Config : ${configPath}`,
    `  State  : ${statePath}`,
  ].join("\n");
}

export async function runCli(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  const command = parseCliArgs(args);

  switch (command.kind) {
    case "version":
      console.log(getPackageVersion());
      return 0;
    case "help":
      console.log(formatHelpText());
      return 0;
    case "init":
      return runInitCommand();
    case "start":
      return runStartCommand();
    case "doctor":
      return runDoctorCommand();
    case "stop":
      return runStopCommand();
    case "unknown":
      console.error(`Unknown command or option: "${command.input}"`);
      console.error("");
      console.error(formatHelpText());
      return 1;
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]).toLowerCase() === resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (isDirectExecution) {
  void runCli().then((code) => {
    if (code !== 0) {
      process.exit(code);
    }
  });
}
