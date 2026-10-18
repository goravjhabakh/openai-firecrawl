export interface FirecrawlProbeResult {
  readonly ready: boolean;
  readonly endpointTested: string;
  readonly status?: number | undefined;
  readonly detail?: string | undefined;
  readonly error?: string | undefined;
}

export interface WaitForReadyOptions {
  readonly timeoutMs?: number | undefined;
  readonly intervalMs?: number | undefined;
  readonly probe?: (apiUrl: string) => Promise<FirecrawlProbeResult>;
}

export class FirecrawlHealthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirecrawlHealthError";
  }
}

/**
 * Isolated probe for testing Firecrawl readiness.
 *
 * Checks:
 * 1. GET ${apiUrl}/v0/health/readiness -> expect 200 and { status: "ok" }
 * 2. Fallback: GET ${apiUrl}/ -> expect 200 and body containing "Firecrawl API"
 *
 * Keeps probe implementation isolated and replaceable without performing scrapes.
 */
export async function probeFirecrawlReadiness(
  apiUrl: string,
  fetchFn: typeof fetch = fetch
): Promise<FirecrawlProbeResult> {
  const normalizedUrl = apiUrl.replace(/\/+$/, "");

  // 1. Primary probe: /v0/health/readiness
  const readinessUrl = `${normalizedUrl}/v0/health/readiness`;
  try {
    const res = await fetchFn(readinessUrl, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });

    if (res.status === 200) {
      try {
        const body = (await res.json()) as { status?: unknown };
        if (body && body.status === "ok") {
          return {
            ready: true,
            endpointTested: readinessUrl,
            status: 200,
            detail: "Readiness probe responded with status: ok",
          };
        }
      } catch {
        // Fall through to fallback check
      }
    }
  } catch {
    // Network or timeout error on primary probe; try root fallback
  }

  // 2. Fallback probe: /
  const rootUrl = `${normalizedUrl}/`;
  try {
    const res = await fetchFn(rootUrl, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });

    if (res.status === 200) {
      try {
        const text = await res.text();
        if (text.includes("Firecrawl API")) {
          return {
            ready: true,
            endpointTested: rootUrl,
            status: 200,
            detail: "Root endpoint responded with Firecrawl API payload",
          };
        }
      } catch {
        // Fall through
      }
    }

    return {
      ready: false,
      endpointTested: rootUrl,
      status: res.status,
      detail: `Endpoint reachable but response did not match expected Firecrawl signature (status ${res.status})`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ready: false,
      endpointTested: rootUrl,
      error: msg,
      detail: `Failed to connect to Firecrawl API at ${normalizedUrl}: ${msg}`,
    };
  }
}

/**
 * Poll until Firecrawl is ready or bounded timeout expires.
 */
export async function waitForFirecrawlReady(
  apiUrl: string,
  options: WaitForReadyOptions = {}
): Promise<FirecrawlProbeResult> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const probe = options.probe ?? ((url) => probeFirecrawlReadiness(url));

  const startTime = Date.now();
  let lastResult: FirecrawlProbeResult | undefined;

  while (Date.now() - startTime < timeoutMs) {
    lastResult = await probe(apiUrl);
    if (lastResult.ready) {
      return lastResult;
    }

    const elapsed = Date.now() - startTime;
    if (elapsed + intervalMs >= timeoutMs) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const detail = lastResult?.error || lastResult?.detail || "Timeout exceeded";
  throw new FirecrawlHealthError(
    `Firecrawl at "${apiUrl}" did not become ready within ${Math.round(timeoutMs / 1000)} seconds. Detail: ${detail}`
  );
}
