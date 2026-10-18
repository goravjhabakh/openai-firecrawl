import { loadConfig } from "../config/index.js";
import { ensureFirecrawlRunning } from "../firecrawl/index.js";
import { ensureMcpRunning } from "../mcp/index.js";

async function main(): Promise<void> {
  try {
    const config = loadConfig();

    console.log("openai-firecrawl start");
    console.log("----------------------");
    console.log(`Firecrawl API URL : ${config.firecrawlApiUrl}`);
    console.log(`MCP Port          : ${config.mcpPort}`);
    console.log(
      `Firecrawl Home    : ${config.firecrawlHome ?? "(not set, external instance expected)"}`
    );
    console.log("");

    // Step 1: Ensure Firecrawl is running
    console.log("1. Checking Firecrawl readiness...");
    const firecrawlResult = await ensureFirecrawlRunning(config);
    console.log(`[OK] Firecrawl Status: ${firecrawlResult.status}`);
    console.log(
      `     - Managed by this project: ${firecrawlResult.owned ? "YES (owned)" : "NO (external)"}`
    );
    console.log(`     - Detail: ${firecrawlResult.detail}`);
    console.log("");

    // Step 2: Ensure official Firecrawl MCP server is running
    console.log("2. Checking Firecrawl MCP server readiness...");
    const mcpResult = await ensureMcpRunning(config);
    console.log(`[OK] MCP Status: ${mcpResult.status}`);
    console.log(
      `     - Managed by this project: ${mcpResult.owned ? "YES (owned)" : "NO (external)"}`
    );
    if (mcpResult.pid !== undefined) {
      console.log(`     - PID: ${mcpResult.pid}`);
    }
    console.log(`     - Endpoint: ${mcpResult.mcpUrl}`);
    console.log(`     - Detail: ${mcpResult.detail}`);
    console.log("");

    console.log("------------------------------------------------------------");
    console.log("SUCCESS: Self-hosted Firecrawl and Firecrawl MCP are ready!");
    console.log(`MCP Server URL: ${mcpResult.mcpUrl}`);
    console.log("Next phase will configure the ChatGPT tunnel / custom MCP link.");
  } catch (error) {
    console.error("");
    if (error instanceof Error) {
      console.error(`[FAIL] Startup error: ${error.message}`);
    } else {
      console.error("[FAIL] Unknown error while starting:", error);
    }
    process.exit(1);
  }
}

void main();
