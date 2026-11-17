/**
 * Scope authorization tests (v0.37.1 security fix, updated for local DNS-store verification).
 *
 * Ownership is proven by the in-app local verified-domain store (DNS TXT challenge
 * record) or an explicit operator attestation. Every check fails closed: a missing
 * or unreadable store denies. No network and no external service are consulted.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkAuthorization, checkScopeAuthorization } from "../src/gate.js";

function storePath(dir: string): string {
  return join(dir, "verified-domains.json");
}

function writeStore(dir: string, domains: string[]): string {
  const file = storePath(dir);
  const verified: Record<string, { token: string; verifiedAt: string; method: "dns-txt" }> = {};
  for (const d of domains) {
    const key = d.trim().toLowerCase().replace(/\.$/, "");
    verified[key] = { token: "secscan-verify-test", verifiedAt: "2026-01-01T00:00:00.000Z", method: "dns-txt" };
  }
  writeFileSync(file, JSON.stringify({ version: 1, pending: {}, verified }, null, 2));
  return file;
}

function emptyStore(dir: string): string {
  const file = storePath(dir);
  writeFileSync(file, JSON.stringify({ version: 1, pending: {}, verified: {} }, null, 2));
  return file;
}

function corruptStore(dir: string): string {
  const file = storePath(dir);
  writeFileSync(file, "{not-json", "utf8");
  return file;
}

describe("checkScopeAuthorization", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rt-gate-scope-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("allows a scope whose DNS hosts are each ownership-verified", async () => {
    const storeFile = writeStore(dir, ["app.example.com", "api.example.com"]);
    const verdict = await checkScopeAuthorization(
      ["app.example.com", "api.example.com"],
      { storeFile, verifiedTarget: "https://app.example.com/landing" },
    );
    assert.equal(verdict.allowed, true);
  });

  it("denies a scope containing a DNS host that is not verified, naming it", async () => {
    const storeFile = writeStore(dir, ["app.example.com"]);
    const verdict = await checkScopeAuthorization(
      ["app.example.com", "someone-elses-site.test"],
      { storeFile, verifiedTarget: "app.example.com" },
    );
    assert.equal(verdict.allowed, false);
    assert.match(verdict.reason ?? "", /someone-elses-site\.test/);
    assert.match(verdict.reason ?? "", /not ownership-verified/);
  });

  it("fails closed when the local store is unreadable/corrupt", async () => {
    const storeFile = corruptStore(dir);
    const verdict = await checkScopeAuthorization(
      ["api.example.com"],
      { storeFile, verifiedTarget: "app.example.com" },
    );
    assert.equal(verdict.allowed, false);
  });

  it("allows an IP-literal scope host (a host engagement target, not a domain)", async () => {
    const storeFile = emptyStore(dir);
    const verdict = await checkScopeAuthorization(
      ["203.0.113.10", "198.51.100.7"],
      { storeFile, verifiedTarget: "app.example.com" },
    );
    assert.equal(verdict.allowed, true);
  });

  it("denies a private/loopback scope host when local sandbox is off", async () => {
    const storeFile = writeStore(dir, ["app.example.com"]);
    const verdict = await checkScopeAuthorization(["127.0.0.1"], {
      storeFile,
      verifiedTarget: "app.example.com" });
    assert.equal(verdict.allowed, false);
    assert.match(verdict.reason ?? "", /local sandbox/);
  });

  it("denies local sandbox combined with a public host in scope (the reported chain)", async () => {
    const storeFile = writeStore(dir, ["some-public-host.example"]);
    const verdict = await checkScopeAuthorization(
      ["127.0.0.1", "some-public-host.example"],
      { storeFile, allowLocalSandbox: true, verifiedTarget: "127.0.0.1" },
    );
    assert.equal(verdict.allowed, false);
    assert.match(verdict.reason ?? "", /some-public-host\.example/);
    assert.match(verdict.reason ?? "", /LOCAL SANDBOX MODE cannot cover/);
  });

  it("allows local sandbox when every scope host is private", async () => {
    const storeFile = emptyStore(dir);
    const verdict = await checkScopeAuthorization(
      ["127.0.0.1", "10.0.0.5", "localhost"],
      { storeFile, allowLocalSandbox: true, verifiedTarget: "127.0.0.1" },
    );
    assert.equal(verdict.allowed, true);
  });

  it("denies an empty scope", async () => {
    const storeFile = emptyStore(dir);
    const verdict = await checkScopeAuthorization(["   "], { storeFile });
    assert.equal(verdict.allowed, false);
    assert.match(verdict.reason ?? "", /scope is empty/);
  });
});

describe("record attestation basis (explicit bypass path)", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rt-gate-attest-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
  const proof = "Operator-attested ownership: the operator attests on the engagement record.";

  it("checkAuthorization allows on the attestation without consulting the local store", async () => {
    const storeFile = emptyStore(dir);
    const verdict = await checkAuthorization("app.example.com", { storeFile, attestedProof: proof });
    assert.equal(verdict.allowed, true);
    assert.equal(verdict.reason, proof);
  });

  it("checkAuthorization still rejects an unparseable target before the attestation applies", async () => {
    const storeFile = emptyStore(dir);
    const verdict = await checkAuthorization("not a url %%%", { storeFile, attestedProof: proof });
    assert.equal(verdict.allowed, false);
  });

  it("checkScopeAuthorization covers every in-scope public host by the attestation", async () => {
    const storeFile = emptyStore(dir);
    const verdict = await checkScopeAuthorization(
      ["app.example.com", "api.example.com"],
      { storeFile, verifiedTarget: "app.example.com", attestedProof: proof },
    );
    assert.equal(verdict.allowed, true);
  });

  it("the attestation does not widen the structural rules: a private scope host is still denied outside sandbox mode", async () => {
    const storeFile = emptyStore(dir);
    const verdict = await checkScopeAuthorization(
      ["app.example.com", "127.0.0.1"],
      { storeFile, verifiedTarget: "app.example.com", attestedProof: proof },
    );
    assert.equal(verdict.allowed, false);
    assert.match(verdict.reason ?? "", /local sandbox/);
  });

  it("the attestation does not rescue an empty scope", async () => {
    const storeFile = emptyStore(dir);
    const verdict = await checkScopeAuthorization(["   "], { storeFile, attestedProof: proof });
    assert.equal(verdict.allowed, false);
    assert.match(verdict.reason ?? "", /scope is empty/);
  });
});

describe("checkAuthorization still gates the target itself", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "rt-gate-target-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("denies an unverified public target even when the scope is otherwise clean", async () => {
    const storeFile = emptyStore(dir);
    const verdict = await checkAuthorization("app.example.com", { storeFile });
    assert.equal(verdict.allowed, false);
  });

  it("local sandbox skips verification only for a private target", async () => {
    const storeFile = emptyStore(dir);
    const allowed = await checkAuthorization("127.0.0.1", { storeFile, allowLocalSandbox: true });
    assert.equal(allowed.allowed, true);
    const denied = await checkAuthorization("app.example.com", { storeFile, allowLocalSandbox: true });
    assert.equal(denied.allowed, false);
  });
});
