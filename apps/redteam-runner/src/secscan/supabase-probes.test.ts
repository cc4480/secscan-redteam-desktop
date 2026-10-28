import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runSupabaseProbes } from "./supabase-probes.js";

/**
 * VibeStack Supabase probe tests.
 * These are VibeScan's most important differentiating feature —
 * detecting exposed Supabase RLS misconfigurations in AI-built apps.
 *
 * All external HTTP calls are stubbed via vi.stubGlobal("fetch", vi.fn()).
 */

// ─── JWT fixtures ─────────────────────────────────────────────────────────────

/**
 * Valid anon key JWT (role: "anon") — public by design, not a vulnerability.
 * Payload: {"role":"anon","iss":"supabase","iat":1600000000,"exp":1960000000}
 */
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
  ".eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNjAwMDAwMDAwLCJleHAiOjE5NjAwMDAwMDB9" +
  ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

/**
 * service_role JWT — bypasses ALL RLS, critical if exposed client-side.
 * Payload: {"role":"service_role","iss":"supabase","iat":1600000000,"exp":1960000000}
 */
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
  ".eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE2MDAwMDAwMDAsImV4cCI6MTk2MDAwMDAwMH0" +
  ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

// ─── HTML fixture helpers ─────────────────────────────────────────────────────

/** Anon key via createClient — extracted by the first keyPattern regex. */
function htmlWithAnonKey(): string {
  return `<script>
    const supabase = createClient(
      'https://abcdefgh.supabase.co',
      '${ANON_KEY}'
    )
  </script>`;
}

/** service_role key via a recognised variable name. */
function htmlWithServiceRoleKey(): string {
  return `<script>
    const SUPABASE_SERVICE_ROLE_KEY = '${SERVICE_ROLE_KEY}'
    const supabase = createClient('https://abcdefgh.supabase.co', SUPABASE_SERVICE_ROLE_KEY)
  </script>`;
}

function htmlWithNoSupabase(): string {
  return `<html><body>Hello world — no Supabase here</body></html>`;
}

// ─── Fetch mock helpers ───────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(impl: (url: string) => Response) {
  vi.mocked(fetch).mockImplementation((input) =>
    Promise.resolve(impl(String(input))),
  );
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── service_role key detection (no HTTP needed for the finding itself) ───────

describe("runSupabaseProbes — service_role key in client code", () => {
  it("reports CRITICAL finding when service_role key is in client-side HTML", async () => {
    // After detecting the service_role key the probe still tries to probe tables;
    // mock subsequent HTTP calls so they return nothing meaningful.
    mockFetch(() => jsonResponse({ message: "Not found" }, 404));

    const findings: any[] = [];
    await runSupabaseProbes(htmlWithServiceRoleKey(), "deep", findings);

    const critical = findings.find(
      (f) => f.severity === "critical" && /service.role/i.test(f.name),
    );
    expect(critical).toBeDefined();
    expect(critical.cvssScore).toBe(10.0);
    expect(critical.cweId).toBe("CWE-522");
  });

  it("does NOT report service_role vuln when only the anon key is present", async () => {
    mockFetch(() => jsonResponse([], 200));

    const findings: any[] = [];
    await runSupabaseProbes(htmlWithAnonKey(), "deep", findings);

    const critical = findings.find(
      (f) => f.severity === "critical" && /service.role/i.test(f.name),
    );
    expect(critical).toBeUndefined();
  });
});

// ─── No Supabase detected ────────────────────────────────────────────────────

describe("runSupabaseProbes — no Supabase in content", () => {
  it("returns no findings and makes no HTTP calls when Supabase is not present", async () => {
    const findings: any[] = [];
    await runSupabaseProbes(htmlWithNoSupabase(), "deep", findings);

    expect(findings).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ─── RLS probe via REST API ───────────────────────────────────────────────────

describe("runSupabaseProbes — RLS checks via REST API", () => {
  it("reports informational finding when Supabase detected but tables not enumerable", async () => {
    // OpenAPI spec returns valid JSON but with no paths/definitions → no tables
    mockFetch(() => jsonResponse({}, 200));

    const findings: any[] = [];
    await runSupabaseProbes(htmlWithAnonKey(), "deep", findings);

    const infoFinding = findings.find((f) => /supabase/i.test(f.name));
    expect(infoFinding).toBeDefined();
  });

  it("reports finding when a table returns rows without authentication (RLS disabled)", async () => {
    // Spec with one table in `definitions`
    const openApiSpec = {
      definitions: {
        users: { properties: { id: { format: "bigint" }, email: { format: "text" } } },
      },
    };

    mockFetch((url) => {
      // Table read: returns array of rows → "open" read result
      if (url.includes("?select=")) {
        return jsonResponse([{ id: 1, email: "user@example.com" }], 200);
      }
      // Write probe: return 401 so it's treated as "protected" (no write finding)
      if (url.includes("/rest/v1/users") && !url.includes("?")) {
        return jsonResponse({ message: "Unauthorized" }, 401);
      }
      // /rest/v1/ (OpenAPI spec endpoint)
      return jsonResponse(openApiSpec, 200);
    });

    const findings: any[] = [];
    await runSupabaseProbes(htmlWithAnonKey(), "deep", findings);

    // "Supabase Tables Readable Without Authentication (CVE-2025-48757)"
    const rlsFinding = findings.find(
      (f) =>
        (f.severity === "critical" || f.severity === "high") &&
        /readable.*auth|CVE-2025-48757/i.test(f.name),
    );
    expect(rlsFinding).toBeDefined();
    expect(rlsFinding.cweId).toBeTruthy();
  });
});
