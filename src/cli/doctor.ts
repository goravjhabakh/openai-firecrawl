import { loadConfig } from "../config/index.js";
import { runDoctorChecks as runFirecrawlDoctorChecks } from "../firecrawl/index.js";
import { runMcpDoctorChecks } from "../mcp/index.js";
import { runTunnelDoctorChecks } from "../tunnel/index.js";

export async function runDoctorCommand(): Promise<number> {
  try {
    const config = loadConfig();

    console.log("openai-firecrawl doctor");
    console.log("-----------------------");

    // 1. Run Firecrawl checks
    const firecrawlReport = await runFirecrawlDoctorChecks(config);

    // 2. Run MCP checks
    const mcpItems = await runMcpDoctorChecks(config);

    // 3. Run Tunnel checks
    const tunnelItems = await runTunnelDoctorChecks(config);

    const allItems = [...firecrawlReport.items, ...mcpItems, ...tunnelItems];
    let allPassed = firecrawlReport.success;

    for (const item of allItems) {
      console.log(`[${item.status}] ${item.title}`);
      for (const line of item.details) {
        console.log(`       ${line}`);
      }
      console.log("");
      if (item.status === "FAIL") {
        allPassed = false;
      }
    }

    if (!allPassed) {
      console.error("Doctor detected one or more critical issues that require attention.");
      return 1;
    }

    console.log("Doctor check completed successfully.");
    return 0;
  } catch (error) {
    console.error("Doctor failed with unexpected error:");
    if (error instanceof Error) {
      console.error(`[FAIL] ${error.message}`);
    } else {
      console.error("[FAIL] Unknown error:", error);
    }
    return 1;
  }
}
