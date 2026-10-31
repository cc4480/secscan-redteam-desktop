import { describe, it, expect } from "vitest";
import { PATH_PROBES } from "./crawler-data.js";

/**
 * Tests for `validate` functions on each PATH_PROBE entry.
 * These run on inner crawled pages and must accurately distinguish
 * real findings from 200-OK-but-wrong-content false positives.
 */

function probeByName(name: string) {
  const probe = PATH_PROBES.find((p) => p.name === name);
  if (!probe) throw new Error(`No PATH_PROBE found with name: ${name}`);
  return probe.validate;
}

// ─── Swagger / OpenAPI ────────────────────────────────────────────────────────

describe("PATH_PROBES: Swagger (swagger.json)", () => {
  const validate = probeByName("API Documentation Exposed on Inner Route (Swagger)");

  it("matches a swagger document", () =>
    expect(validate(`{"swagger":"2.0","info":{}}`, "application/json", 200)).toBe(true));
  it("matches openapi key inside swagger.json", () =>
    expect(validate(`{"openapi":"3.0","paths":{}}`, "application/json", 200)).toBe(true));
  it("rejects HTML 404 response", () =>
    expect(validate("<html>Not Found</html>", "text/html", 404)).toBe(false));
  it("rejects empty body", () =>
    expect(validate("", "application/json", 200)).toBe(false));
});

describe("PATH_PROBES: OpenAPI (openapi.json)", () => {
  const validate = probeByName("API Documentation Exposed on Inner Route (OpenAPI)");

  it("matches openapi key", () =>
    expect(validate(`{"openapi":"3.0.0"}`, "application/json", 200)).toBe(true));
  it("matches swagger key", () =>
    expect(validate(`{"swagger":"2.0"}`, "application/json", 200)).toBe(true));
  it("rejects an empty JSON object", () =>
    expect(validate("{}", "application/json", 200)).toBe(false));
});

describe("PATH_PROBES: api-docs", () => {
  const validate = probeByName("API Documentation Exposed on Inner Route");

  it("matches a response containing 'paths'", () =>
    expect(validate(`{"paths":{"/users":{}}}`, "application/json", 200)).toBe(true));
  it("rejects a short JSON without API keys", () =>
    expect(validate(`{"status":"ok"}`, "application/json", 200)).toBe(false));
});

// ─── .env on inner route ──────────────────────────────────────────────────────

describe("PATH_PROBES: .env on inner route", () => {
  const validate = probeByName("Environment File Exposed on Inner Route");

  it("matches KEY=VALUE env content with non-HTML content-type", () =>
    expect(validate("DATABASE_URL=postgres://user:pass@host/db\n", "text/plain", 200)).toBe(true));
  it("matches even with text/html content-type if body looks like .env", () =>
    expect(validate("SECRET=abc\nAPI_KEY=xyz\n", "text/html", 200)).toBe(true));
  it("rejects a genuine HTML page even if it contains = characters", () =>
    expect(validate("<!DOCTYPE html><html><body>href=foo</body></html>", "text/html", 200)).toBe(false));
});

// ─── .git/HEAD on inner route ─────────────────────────────────────────────────

describe("PATH_PROBES: .git/HEAD on inner route", () => {
  const validate = probeByName("Git Repository Exposed on Inner Route");

  it("matches ref: refs/heads/main", () =>
    expect(validate("ref: refs/heads/main\n", "text/plain", 200)).toBe(true));
  it("matches a bare 40-char SHA", () =>
    expect(validate("d6b7c8a9e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6\n", "text/plain", 200)).toBe(true));
  it("rejects an HTML page", () =>
    expect(validate("<html>Not Found</html>", "text/html", 404)).toBe(false));
});

// ─── config.json ─────────────────────────────────────────────────────────────

describe("PATH_PROBES: config.json on inner route", () => {
  const validate = probeByName("Configuration File Exposed on Inner Route");

  it("matches a non-trivial JSON object with JSON content type", () =>
    expect(validate(`{"apiUrl":"https://api.example.com","key":"abc123"}`, "application/json", 200)).toBe(true));
  it("matches body that starts with { even without JSON content-type", () =>
    expect(validate(`{"setting":true,"debug":false,"apiUrl":"https://api.example.com"}`, "text/plain", 200)).toBe(true));
  it("rejects a tiny body (too short to be meaningful)", () =>
    expect(validate("{}", "application/json", 200)).toBe(false));
  it("rejects HTML response", () =>
    expect(validate("<html>Not Found</html>", "text/html", 404)).toBe(false));
});

// ─── GraphQL ─────────────────────────────────────────────────────────────────

describe("PATH_PROBES: GraphQL endpoint on inner route", () => {
  const validate = probeByName("GraphQL Endpoint Exposed on Inner Route");

  it("matches introspection response with __schema", () =>
    expect(validate(`{"data":{"__schema":{"types":[]}}}`, "application/json", 200)).toBe(true));
  it("matches playground HTML containing 'GraphQL'", () =>
    expect(validate("<html>GraphQL Playground</html>", "text/html", 200)).toBe(true));
  it("matches error response mentioning graphql", () =>
    expect(validate(`{"errors":[{"message":"graphql syntax error"}]}`, "application/json", 200)).toBe(true));
  it("rejects a random JSON response", () =>
    expect(validate(`{"status":"ok"}`, "application/json", 200)).toBe(false));
});

// ─── Debug log ────────────────────────────────────────────────────────────────

describe("PATH_PROBES: debug log on inner route", () => {
  const validate = probeByName("Debug Log Exposed on Inner Route");

  it("matches a real log file body", () =>
    expect(
      validate(
        "[2025-01-01 12:00:00] ERROR: Database connection failed at db.js:42\n" +
        "[2025-01-01 12:00:01] WARN: Retrying connection attempt 1 of 3\n" +
        "[2025-01-01 12:00:02] DEBUG: Connection pool exhausted — waiting 500ms\n",
        "text/plain",
        200,
      ),
    ).toBe(true));
  it("rejects body that is too short (< 100 chars)", () =>
    expect(validate("error", "text/plain", 200)).toBe(false));
  it("rejects a body with no log-like keywords", () =>
    expect(validate("x".repeat(200), "text/plain", 200)).toBe(false));
});
