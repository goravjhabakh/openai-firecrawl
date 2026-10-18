import type { AppConfig } from "../config/index.js";
import { loadConfig } from "../config/index.js";
import { stopManagedFirecrawl } from "../firecrawl/index.js";
import { stopManagedMcp } from "../mcp/index.js";
import { stopManagedTunnel } from "../tunnel/index.js";

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
        tunnelId: undefined,
        hasTunnelApiKey: false,
        tunnelApiKeyEnvVar: undefined,
        tunnelClientBin: undefined,
        tunnelHealthPort: 8080,
      };
    }

    console.log("openai-firecrawl stop");
    console.log("---------------------");

    // 1. Stop Tunnel first (stops incoming ChatGPT requests)
    console.log("1. Stopping managed OpenAI Secure MCP Tunnel if running...");
    const tunnelResult = await stopManagedTunnel(config);
    console.log(`[INFO] Tunnel Action: ${tunnelResult.action}`);
    console.log(`       ${tunnelResult.message}`);
    console.log("");

    // 2. Stop MCP second
    console.log("2. Stopping managed MCP server if running...");
    const mcpResult = await stopManagedMcp(config);
    console.log(`[INFO] MCP Action: ${mcpResult.action}`);
    console.log(`       ${mcpResult.message}`);
    console.log("");

    // 3. Stop Firecrawl third
    console.log("3. Stopping managed Firecrawl instance if running...");
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
