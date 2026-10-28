import { describe, it, expect } from "vitest";
import { SENSITIVE_PATHS } from "./probes-data.js";

/**
 * Tests for the `validate` functions on each SENSITIVE_PATH entry.
 * These validators are the sole gate between "HTTP 200 response" and
 * "vulnerability reported" — a false-positive or false-negative here
 * directly impacts report quality.
 */

function probeByPath(path: string) {
  const probe = SENSITIVE_PATHS.find((p) => p.path === path);
  if (!probe) throw new Error(`No probe found for path: ${path}`);
  return probe.validate;
}

// ─── .git/HEAD ────────────────────────────────────────────────────────────────

describe("SENSITIVE_PATHS: /.git/HEAD", () => {
  const validate = probeByPath("/.git/HEAD");

  it("matches valid ref: refs/heads/main response", () =>
    expect(validate("ref: refs/heads/main\n", "text/plain")).toBe(true));
  it("matches a bare commit SHA (git worktree)", () =>
    expect(validate("d6b7c8a9e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6\n", "text/plain")).toBe(true));
  it("rejects an HTML 404 page", () =>
    expect(validate("<html><body>Not Found</body></html>", "text/html")).toBe(false));
  it("rejects empty body", () =>
    expect(validate("", "text/plain")).toBe(false));
});

// ─── .git/config ─────────────────────────────────────────────────────────────

describe("SENSITIVE_PATHS: /.git/config", () => {
  const validate = probeByPath("/.git/config");

  it("matches a real git config body", () =>
    expect(validate("[core]\n\trepositoryformatversion = 0\n", "text/plain")).toBe(true));
  it("matches [remote origin]", () =>
    expect(validate('[remote "origin"]\n\turl = git@github.com:user/repo.git\n', "text/plain")).toBe(true));
  it("rejects HTML page", () =>
    expect(validate("<html>Not Found</html>", "text/html")).toBe(false));
});

// ─── .env ─────────────────────────────────────────────────────────────────────

describe("SENSITIVE_PATHS: /.env", () => {
  const validate = probeByPath("/.env");

  it("matches a well-formed .env file", () =>
    expect(validate("DATABASE_URL=postgres://user:pass@host/db\nSECRET_KEY=abc123\n", "text/plain")).toBe(true));
  it("matches underscore-prefixed var", () =>
    expect(validate("_MY_VAR=value", "text/plain")).toBe(true));
  it("rejects an HTML page", () =>
    expect(validate("<!DOCTYPE html><html>", "text/html")).toBe(false));
  it("rejects empty body", () =>
    expect(validate("", "text/plain")).toBe(false));
  it("rejects body that looks like prose, not key=value", () =>
    expect(validate("This is just some text on the page", "text/plain")).toBe(false));
});

// ─── wp-config.php ────────────────────────────────────────────────────────────

describe("SENSITIVE_PATHS: /wp-config.php", () => {
  const validate = probeByPath("/wp-config.php");

  it("matches body containing DB_PASSWORD", () =>
    expect(validate("define('DB_PASSWORD', 'hunter2');", "text/html")).toBe(true));
  it("matches body containing table_prefix", () =>
    expect(validate("$table_prefix = 'wp_';", "text/html")).toBe(true));
  it("matches body containing AUTH_KEY", () =>
    expect(validate("define('AUTH_KEY', 'abc123');", "text/html")).toBe(true));
  it("rejects a generic PHP response with no WP markers", () =>
    expect(validate("<?php echo 'Hello World'; ?>", "text/html")).toBe(false));
});

// ─── phpinfo.php ──────────────────────────────────────────────────────────────

describe("SENSITIVE_PATHS: /phpinfo.php", () => {
  const validate = probeByPath("/phpinfo.php");

  it("matches real phpinfo() output header", () =>
    expect(validate("<title>phpinfo()</title>", "text/html")).toBe(true));
  it("matches 'PHP Version' string", () =>
    expect(validate("PHP Version 8.2.10", "text/html")).toBe(true));
  it("rejects 404 page", () =>
    expect(validate("<html><body>Not found</body></html>", "text/html")).toBe(false));
});

// ─── SQL dumps ────────────────────────────────────────────────────────────────

describe("SENSITIVE_PATHS: /backup.sql", () => {
  const validate = probeByPath("/backup.sql");

  it("matches a MySQL dump header", () =>
    expect(validate("-- MySQL dump 10.13\nCREATE TABLE users", "application/octet-stream")).toBe(true));
  it("matches CREATE TABLE at the top of the file", () =>
    expect(validate("CREATE TABLE users (id INT PRIMARY KEY);", "text/plain")).toBe(true));
  it("rejects HTML 404", () =>
    expect(validate("<html>404</html>", "text/html")).toBe(false));
  it("rejects short empty-looking body", () =>
    expect(validate("", "text/plain")).toBe(false));
});

// ─── /api-docs (Swagger) ──────────────────────────────────────────────────────

describe("SENSITIVE_PATHS: /swagger.json", () => {
  const validate = probeByPath("/swagger.json");

  it("matches a Swagger 2.0 document", () =>
    expect(validate(`{"swagger":"2.0","paths":{}}`, "application/json")).toBe(true));
  it("matches an OpenAPI 3 document", () =>
    expect(validate(`{"openapi":"3.0.0","paths":{}}`, "application/json")).toBe(true));
  it("rejects an empty JSON object", () =>
    expect(validate("{}", "application/json")).toBe(false));
  it("rejects HTML", () =>
    expect(validate("<html>Not found</html>", "text/html")).toBe(false));
});
