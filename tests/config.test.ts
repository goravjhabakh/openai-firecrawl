import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../src/config/index.js";

describe("parseConfig", () => {
  it("uses default values when environment variables are omitted", () => {
    const config = parseConfig({});

    expect(config).toEqual({
      firecrawlApiUrl: "http://localhost:3002",
      firecrawlHome: undefined,
      mcpPort: 3000,
      tunnelId: undefined,
      hasTunnelApiKey: false,
      tunnelApiKeyEnvVar: undefined,
      tunnelClientBin: undefined,
      tunnelHealthPort: 8080,
    });
  });

  it("parses valid values correctly including tunnel configuration", () => {
    const config = parseConfig({
      FIRECRAWL_API_URL: "https://custom-firecrawl.local:4000",
      FIRECRAWL_HOME: "C:/projects/firecrawl",
      MCP_PORT: "8000",
      CONTROL_PLANE_TUNNEL_ID: "tunnel_0123456789abcdef0123456789abcdef",
      CONTROL_PLANE_API_KEY: "sk-test-secret-key-12345",
      TUNNEL_CLIENT_BIN: "C:/tools/tunnel-client.exe",
      TUNNEL_HEALTH_PORT: "8081",
    });

    expect(config).toEqual({
      firecrawlApiUrl: "https://custom-firecrawl.local:4000",
      firecrawlHome: "C:/projects/firecrawl",
      mcpPort: 8000,
      tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
      hasTunnelApiKey: true,
      tunnelApiKeyEnvVar: "CONTROL_PLANE_API_KEY",
      tunnelClientBin: "C:/tools/tunnel-client.exe",
      tunnelHealthPort: 8081,
    });
  });

  it("accepts namespaced tunnel IDs (4-char namespace)", () => {
    const config = parseConfig({
      CONTROL_PLANE_TUNNEL_ID: "tunnel_prod_0123456789abcdef0123456789abcdef",
    });

    expect(config.tunnelId).toBe("tunnel_prod_0123456789abcdef0123456789abcdef");
  });

  it("falls back to OPENAI_API_KEY for tunnel API key presence detection", () => {
    const config = parseConfig({
      OPENAI_API_KEY: "sk-openai-key-abc",
    });

    expect(config.hasTunnelApiKey).toBe(true);
    expect(config.tunnelApiKeyEnvVar).toBe("OPENAI_API_KEY");
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

  it("rejects invalid CONTROL_PLANE_TUNNEL_ID format", () => {
    expect(() => parseConfig({ CONTROL_PLANE_TUNNEL_ID: "invalid-tunnel-id" })).toThrowError(
      ConfigError
    );
    expect(() => parseConfig({ CONTROL_PLANE_TUNNEL_ID: "tunnel_short" })).toThrowError(
      ConfigError
    );
    expect(() =>
      parseConfig({
        CONTROL_PLANE_TUNNEL_ID: "tunnel_TOOLONGNAMESPACE_12345678901234567890123456789012",
      })
    ).toThrowError(ConfigError);
  });

  it("rejects invalid TUNNEL_HEALTH_PORT", () => {
    expect(() => parseConfig({ TUNNEL_HEALTH_PORT: "abc" })).toThrowError(ConfigError);
    expect(() => parseConfig({ TUNNEL_HEALTH_PORT: "70000" })).toThrowError(ConfigError);
    expect(() => parseConfig({ TUNNEL_HEALTH_PORT: "0" })).toThrowError(ConfigError);
  });

  it("rejects port collision when MCP_PORT and TUNNEL_HEALTH_PORT are equal", () => {
    expect(() =>
      parseConfig({
        MCP_PORT: "3000",
        TUNNEL_HEALTH_PORT: "3000",
      })
    ).toThrowError(ConfigError);
  });
});
