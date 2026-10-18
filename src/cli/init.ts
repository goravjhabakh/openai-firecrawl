import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CONFIG_TEMPLATE, getDefaultConfigFilePath } from "../config/index.js";

export interface InitCommandResult {
  readonly status: "created" | "already-exists";
  readonly configPath: string;
}

export function initConfigFile(
  configPath: string = getDefaultConfigFilePath(),
  template: string = CONFIG_TEMPLATE
): InitCommandResult {
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (existsSync(configPath)) {
    return {
      status: "already-exists",
      configPath,
    };
  }

  writeFileSync(configPath, template, { encoding: "utf8", flag: "wx" });
  return {
    status: "created",
    configPath,
  };
}

export async function runInitCommand(
  configPath: string = getDefaultConfigFilePath()
): Promise<number> {
  try {
    const result = initConfigFile(configPath);

    if (result.status === "created") {
      console.log("Config created:");
      console.log(result.configPath);
      console.log("");
      console.log("Edit the config, then run:");
      console.log("openai-firecrawl doctor");
    } else {
      console.log("Config already exists (left unchanged):");
      console.log(result.configPath);
      console.log("");
      console.log("Edit the config if needed, then run:");
      console.log("openai-firecrawl doctor");
    }

    return 0;
  } catch (error) {
    if (error instanceof Error) {
      console.error(`[FAIL] Init error: ${error.message}`);
    } else {
      console.error("[FAIL] Unknown error during init:", error);
    }
    return 1;
  }
}
