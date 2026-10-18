import { loadConfig } from "../config/index.js";
import { runDoctorChecks } from "../firecrawl/index.js";

async function main(): Promise<void> {
  try {
    const config = loadConfig();

    console.log("openai-firecrawl doctor");
    console.log("-----------------------");

    const report = await runDoctorChecks(config);

    for (const item of report.items) {
      console.log(`[${item.status}] ${item.title}`);
      for (const line of item.details) {
        console.log(`       ${line}`);
      }
      console.log("");
    }

    if (!report.success) {
      console.error("Doctor detected one or more critical issues that require attention.");
      process.exit(1);
    }

    console.log("Doctor check completed successfully.");
  } catch (error) {
    console.error("Doctor failed with unexpected error:");
    if (error instanceof Error) {
      console.error(`[FAIL] ${error.message}`);
    } else {
      console.error("[FAIL] Unknown error:", error);
    }
    process.exit(1);
  }
}

void main();
