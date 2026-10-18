import { loadConfig } from "../config/index.js";

async function main(): Promise<void> {
  try {
    const config = loadConfig();

    console.log("openai-firecrawl (Phase 1 Foundation)");
    console.log("------------------------------------");
    console.log(`Firecrawl API URL : ${config.firecrawlApiUrl}`);
    console.log(`MCP Port          : ${config.mcpPort}`);
    console.log(
      `Firecrawl Home    : ${config.firecrawlHome ?? "(not set, external instance expected)"}`
    );
    console.log("Configuration is valid.");
    console.log("Ready to implement lifecycle and connection phases.");
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error("Unknown error while starting:", error);
    }
    process.exit(1);
  }
}

void main();
