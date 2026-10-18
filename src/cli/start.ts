import { loadConfig } from "../config/index.js";
import { ensureFirecrawlRunning } from "../firecrawl/index.js";

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
    console.log("Checking Firecrawl readiness...");

    const result = await ensureFirecrawlRunning(config);

    console.log("");
    console.log(`[OK] Firecrawl Status: ${result.status}`);
    console.log(
      `     - Managed by this project: ${result.owned ? "YES (owned)" : "NO (external)"}`
    );
    console.log(`     - Detail: ${result.detail}`);
    console.log("");
    console.log("Firecrawl lifecycle check passed.");
    console.log("Next phases will connect the official MCP server and ChatGPT link.");
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
