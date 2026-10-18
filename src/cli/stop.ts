import type { AppConfig } from "../config/index.js";
import { loadConfig } from "../config/index.js";
import { stopManagedFirecrawl } from "../firecrawl/index.js";

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

    const result = await stopManagedFirecrawl(config);

    console.log(`[INFO] Action: ${result.action}`);
    console.log(`       ${result.message}`);
    if (result.firecrawlHome) {
      console.log(`       Location: ${result.firecrawlHome}`);
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
