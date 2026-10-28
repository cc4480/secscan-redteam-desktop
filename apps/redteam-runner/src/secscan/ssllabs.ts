/**
 * SSL Labs API integration.
 * Uses the free Qualys SSL Labs API v3 (no key required).
 *
 * Strategy:
 *   Always trigger a fresh assessment (startNew=on, fromCache=off) so every
 *   scan reflects the current TLS configuration rather than 24h-old data.
 *   Poll for up to MAX_WAIT_MS. If still not READY, return null (graceful
 *   degradation — scan continues without TLS grade).
 *
 * Reference: https://github.com/ssllabs/ssllabs-scan/blob/master/ssllabs-api-docs-v3.md
 */

const SSL_LABS_BASE    = "https://api.ssllabs.com/api/v3";
const POLL_INTERVAL_MS = 10_000;  // 10 s between polls
const MAX_WAIT_MS      = 30_000;  // 30 s max total wait (was 120 s — reduced to avoid hung scans)
const FETCH_TIMEOUT_MS = 10_000;  // 10 s abort timeout per individual HTTP request

export interface SslLabsResult {
  grade: string | null;
  hasWarnings: boolean;
  isExceptional: boolean;
  issues: string[];
}

interface SslLabsEndpoint {
  grade?: string;
  gradeTrustIgnored?: string;
  hasWarnings?: boolean;
  isExceptional?: boolean;
  statusMessage?: string;
  statusDetails?: string;
  statusDetailsMessage?: string;
}

interface SslLabsResponse {
  status: string;
  host?: string;
  endpoints?: SslLabsEndpoint[];
  errors?: Array<{ message: string }>;
}

async function fetchAnalysis(host: string, startNew: boolean): Promise<SslLabsResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const params = new URLSearchParams({
    host,
    fromCache: startNew ? "off" : "on",
    all: "done",
  });
  if (startNew) params.set("startNew", "on");

  try {
    const res = await fetch(`${SSL_LABS_BASE}/analyze?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`SSL Labs API returned ${res.status}`);
    return res.json() as Promise<SslLabsResponse>;
  } finally {
    clearTimeout(timer);
  }
}

function extractResult(data: SslLabsResponse): SslLabsResult {
  const endpoint = data.endpoints?.[0];
  const grade = endpoint?.grade ?? null;
  const issues: string[] = [];

  if (endpoint?.hasWarnings)                    issues.push("SSL Labs flagged configuration warnings");
  if (grade === "T")                            issues.push("Certificate is not trusted");
  if (grade && /^[C-F]$/.test(grade))          issues.push(`Weak SSL configuration — grade ${grade}`);
  if (endpoint?.statusDetailsMessage)           issues.push(endpoint.statusDetailsMessage);

  return {
    grade,
    hasWarnings:   endpoint?.hasWarnings   ?? false,
    isExceptional: endpoint?.isExceptional ?? false,
    issues,
  };
}

/**
 * Run an SSL Labs assessment for the given HTTPS hostname.
 * Returns null if the target is not HTTPS, the API times out, or an error occurs.
 */
export async function checkSslLabs(targetUrl: string): Promise<SslLabsResult | null> {
  let hostname: string;
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== "https:") return null;
    hostname = parsed.hostname;
  } catch {
    return null;
  }

  // Always trigger a fresh assessment — never serve cached data.
  // Poll for up to MAX_WAIT_MS; gracefully skip if SSL Labs doesn't finish in time.
  const deadline = Date.now() + MAX_WAIT_MS;
  let isFirstPoll = true;
  let data: SslLabsResponse;

  while (Date.now() < deadline) {
    if (!isFirstPoll) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise<void>((r) => setTimeout(r, Math.min(POLL_INTERVAL_MS, remaining)));
    }

    try {
      data = await fetchAnalysis(hostname, isFirstPoll);
      isFirstPoll = false;
    } catch (err) {
      console.warn("[ssllabs] Poll request failed:", err);
      return null;
    }

    if (data.status === "READY")  return extractResult(data);
    if (data.status === "ERROR") {
      console.warn("[ssllabs] Assessment error:", data.errors?.[0]?.message ?? "unknown");
      return null;
    }
  }

  console.warn("[ssllabs] Assessment timed out after", MAX_WAIT_MS, "ms — continuing without TLS grade");
  return null;
}
