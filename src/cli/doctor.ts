import { loadConfig } from "../config/index.js";

async function main(): Promise<void> {
  try {
    const config = loadConfig();

    console.log("openai-firecrawl doctor (Phase 1 Foundation)");
    console.log("-------------------------------------------");
    console.log("[PASS] Configuration valid:");
    console.log(`       - FIRECRAWL_API_URL: ${config.firecrawlApiUrl}`);
    console.log(`       - MCP_PORT: ${config.mcpPort}`);
    console.log(
      `       - FIRECRAWL_HOME: ${config.firecrawlHome ?? "(not set, external instance expected)"}`
    );
    console.log("[INFO] Service and container health checks will be implemented in Phase 2.");
  } catch (error) {
    console.error("Doctor detected issues:");
    if (error instanceof Error) {
      console.error(`[FAIL] Configuration error: ${error.message}`);
    } else {
      console.error("[FAIL] Unknown error:", error);
    }
    process.exit(1);
  }
}

void main();
