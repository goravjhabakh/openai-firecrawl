import { getDefaultConfigFilePath, loadConfig } from "../config/index.js";
import { ensureFirecrawlRunning } from "../firecrawl/index.js";
import { ensureMcpRunning } from "../mcp/index.js";
import { ensureTunnelRunning } from "../tunnel/index.js";

export async function runStartCommand(): Promise<number> {
  try {
    const configPath = getDefaultConfigFilePath();
    const config = loadConfig(configPath);

    console.log("openai-firecrawl start");
    console.log("----------------------");
    console.log(`Config File       : ${configPath}`);
    console.log(`Firecrawl API URL : ${config.firecrawlApiUrl}`);
    console.log(`MCP Port          : ${config.mcpPort}`);
    console.log(
      `Firecrawl Home    : ${config.firecrawlHome ?? "(not set, external instance expected)"}`
    );
    console.log(`Tunnel ID         : ${config.tunnelId ?? "(not set)"}`);
    console.log(
      `Tunnel API Key    : ${config.hasTunnelApiKey ? `Configured via ${config.tunnelApiKeyEnvVar}` : "(not set)"}`
    );
    console.log(`Tunnel Health Port: ${config.tunnelHealthPort}`);
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

    // Step 3: Ensure OpenAI Secure MCP Tunnel is running
    console.log("3. Checking OpenAI Secure MCP Tunnel readiness...");
    const tunnelResult = await ensureTunnelRunning(config);
    console.log(`[OK] Tunnel Status: ${tunnelResult.status}`);
    console.log(
      `     - Managed by this project: ${tunnelResult.owned ? "YES (owned)" : "NO (external)"}`
    );
    if (tunnelResult.pid !== undefined) {
      console.log(`     - PID: ${tunnelResult.pid}`);
    }
    console.log(`     - Tunnel ID: ${tunnelResult.tunnelId}`);
    console.log(`     - Local Health/Admin UI: ${tunnelResult.healthUrl}/ui`);
    console.log(`     - Detail: ${tunnelResult.detail}`);
    console.log("");

    console.log("============================================================");
    console.log("SUCCESS: Self-hosted Firecrawl, MCP, and Tunnel are READY!");
    console.log("============================================================");
    console.log(`Local MCP Endpoint: ${mcpResult.mcpUrl}`);
    console.log(`Tunnel ID         : ${tunnelResult.tunnelId}`);
    console.log(`Tunnel Admin UI   : ${tunnelResult.healthUrl}/ui`);
    console.log("");
    console.log("ChatGPT Connection Steps:");
    console.log("1. Open ChatGPT -> Settings -> Connectors (or ChatGPT Plugins).");
    console.log("2. Click 'Add custom MCP server'.");
    console.log("3. Choose 'Connection: Tunnel'.");
    console.log(`4. Select or enter Tunnel ID: ${tunnelResult.tunnelId}`);
    console.log("5. Choose 'No authentication' (local keyless firecrawl-mcp).");
    console.log("6. Save/Create plugin and start querying your local Firecrawl!");

    return 0;
  } catch (error) {
    console.error("");
    if (error instanceof Error) {
      console.error(`[FAIL] Startup error: ${error.message}`);
    } else {
      console.error("[FAIL] Unknown error while starting:", error);
    }
    return 1;
  }
}
