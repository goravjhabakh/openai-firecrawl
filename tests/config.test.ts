import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../src/config/index.js";

describe("parseConfig", () => {
  it("uses default values when environment variables are omitted", () => {
    const config = parseConfig({});

    expect(config).toEqual({
      firecrawlApiUrl: "http://localhost:3002",
      firecrawlHome: undefined,
      mcpPort: 3000,
    });
  });

  it("parses valid values correctly", () => {
    const config = parseConfig({
      FIRECRAWL_API_URL: "https://custom-firecrawl.local:4000",
      FIRECRAWL_HOME: "C:/projects/firecrawl",
      MCP_PORT: "8080",
    });

    expect(config).toEqual({
      firecrawlApiUrl: "https://custom-firecrawl.local:4000",
      firecrawlHome: "C:/projects/firecrawl",
      mcpPort: 8080,
    });
  });

  it("normalizes trailing slashes on FIRECRAWL_API_URL", () => {
    const config = parseConfig({
      FIRECRAWL_API_URL: "http://localhost:3002/",
    });

    expect(config.firecrawlApiUrl).toBe("http://localhost:3002");
  });

  it("preserves URL sub-paths if provided without trailing slash", () => {
    const config = parseConfig({
      FIRECRAWL_API_URL: "http://localhost:3002/api/v1/",
    });

    expect(config.firecrawlApiUrl).toBe("http://localhost:3002/api/v1");
  });

  it("ignores whitespace-only FIRECRAWL_HOME", () => {
    const config = parseConfig({
      FIRECRAWL_HOME: "   ",
    });

    expect(config.firecrawlHome).toBeUndefined();
  });

  it("rejects invalid FIRECRAWL_API_URL string", () => {
    expect(() => parseConfig({ FIRECRAWL_API_URL: "not-a-url" })).toThrowError(ConfigError);
  });

  it("rejects non-http/https FIRECRAWL_API_URL", () => {
    expect(() => parseConfig({ FIRECRAWL_API_URL: "ftp://localhost:3002" })).toThrowError(
      ConfigError
    );
  });

  it("rejects non-integer MCP_PORT", () => {
    expect(() => parseConfig({ MCP_PORT: "3000.5" })).toThrowError(ConfigError);
    expect(() => parseConfig({ MCP_PORT: "abc" })).toThrowError(ConfigError);
  });

  it("rejects out-of-range MCP_PORT", () => {
    expect(() => parseConfig({ MCP_PORT: "0" })).toThrowError(ConfigError);
    expect(() => parseConfig({ MCP_PORT: "65536" })).toThrowError(ConfigError);
    expect(() => parseConfig({ MCP_PORT: "-1" })).toThrowError(ConfigError);
  });
});
