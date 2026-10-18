import type { AppConfig } from "../config/index.js";
import { loadConfig } from "../config/index.js";
import { stopManagedFirecrawl } from "../firecrawl/index.js";
import { stopManagedMcp } from "../mcp/index.js";

async function main(): Promise<void> {
  try {
    let config: AppConfig;
    try {
      config = loadConfig();
    } catch {
      // If config cannot be loaded from .env, fall back to empty defaults so stop can inspect state file
      config = {
        firecrawlApiUrl: "http://localhost:3002",
        firecrawlHome: undefined,
        mcpPort: 3000,
      };
    }

    console.log("openai-firecrawl stop");
    console.log("---------------------");

    // 1. Stop MCP first
    console.log("1. Stopping managed MCP server if running...");
    const mcpResult = await stopManagedMcp(config);
    console.log(`[INFO] MCP Action: ${mcpResult.action}`);
    console.log(`       ${mcpResult.message}`);
    console.log("");

    // 2. Stop Firecrawl second
    console.log("2. Stopping managed Firecrawl instance if running...");
    const firecrawlResult = await stopManagedFirecrawl(config);
    console.log(`[INFO] Firecrawl Action: ${firecrawlResult.action}`);
    console.log(`       ${firecrawlResult.message}`);
    if (firecrawlResult.firecrawlHome) {
      console.log(`       Location: ${firecrawlResult.firecrawlHome}`);
    }
  } catch (error) {
    console.error("");
    if (error instanceof Error) {
      console.error(`[FAIL] Stop error: ${error.message}`);
    } else {
      console.error("[FAIL] Unknown error while stopping:", error);
    }
    process.exit(1);
  }
}

void main();
