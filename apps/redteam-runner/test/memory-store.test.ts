/**
 * Memory store + views + schema/scope-binding tests (brief §11).
 * Trust/collapse/scope-gate unit tests live in memory-core.test.ts;
 * the recall-path integration tests live in memory-integration.test.ts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MemoryError } from "../src/memory/errors.js";
import { resolveMemoryPaths } from "../src/memory/paths.js";
import { computeUnitId, parseUnitLine, validateUnit } from "../src/memory/schema.js";
import { assertScopeBinding, deriveMemoryScope } from "../src/memory/scope.js";
import { finalizeUnit, openMemoryStore, reindexMemoryStore, type UnitDraft } from "../src/memory/store.js";
import { ensureViews, generateUnitViews, refreshDirectoryView } from "../src/memory/views.js";
import type { MemoryUnit } from "../src/memory/types.js";

const NOW = "2026-10-31T13:30:00.000Z";

function tempStoreRoot(): string {
  return mkdtempSync(join(tmpdir(), "memory-store-"));
}

function draftFinding(claim: string, host = "a.example.test"): UnitDraft {
  const scope = deriveMemoryScope({
    engagementId: "eng-1",
    hosts: [host],
    verifiedAt: NOW,
    verificationProof: "dns-txt attestation",
  });
  return {
    schemaVersion: 1,
    unitId: computeUnitId(scope.scopeKey, "finding", claim, "registry-entry:vuln-0001"),
    kind: "finding",
    claim,
    body: `Detail for: ${claim}`,
    scope,
    provenance: {
      sourceClass: "registry",
      sourceEngagementId: "eng-1",
      sourceRefs: [{ kind: "registry-entry", uri: "engagements/registry.json", registryEntryId: "vuln-0001" }],
      derivedFromUnitIds: [],
      extractor: { name: "registry-projector", version: "1", inputHash: "input-hash" },
      createdAt: NOW,
      createdBy: "runner",
    },
    proof: {
      state: "confirmed",
      receipts: [{ kind: "registry-entry", ref: "evidence/p7.md" }],
      registryEntryId: "vuln-0001",
    },
    corroboration: { independentCount: 0, sourceKeys: ["registry:eng-1"] },
    contentClass: "normal",
    tags: ["bola"],
    attackIds: ["T1190"],
    vulnClass: "IDOR",
    stack: [],
  };
}

function appendFinding(store: ReturnType<typeof openMemoryStore>, claim: string, status: "active" | "proposed" = "active"): MemoryUnit {
  const unit = finalizeUnit(draftFinding(claim), NOW);
  store.appendUnitVersion(unit, { status, by: "runner", reason: "MECHANICAL_PROJECTION", at: NOW });
  return unit;
}

function expectMemoryError(code: string, fn: () => unknown): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof MemoryError, `expected MemoryError, got ${String(err)}`);
    assert.equal(err.code, code);
    return true;
  });
}

describe("memory schema + scope binding (brief §11)", () => {
  it("unit without scope is rejected", () => {
    const unit = finalizeUnit(draftFinding("scope binding holds"), NOW);
    const raw = JSON.parse(JSON.stringify(unit)) as Record<string, unknown>;
    delete raw.scope;
    expectMemoryError("SCHEMA_INVALID", () => validateUnit(raw, "test"));
  });

  it("target-derived unit without hosts is rejected", () => {
    const unit = finalizeUnit(draftFinding("hosts are required"), NOW);
    const raw = JSON.parse(JSON.stringify(unit)) as Record<string, unknown>;
    raw.scope = { ...(raw.scope as Record<string, unknown>), hosts: [] };
    expectMemoryError("SCHEMA_INVALID", () => validateUnit(raw, "test"));
  });

  it("class-scoped unit asserting a host-specific value is rejected (SCOPE_TOO_BROAD)", () => {
    const unit = finalizeUnit(draftFinding("the login at https://a.example.test/login accepts replayed tokens"), NOW);
    const reScoped: MemoryUnit = {
      ...unit,
      scope: { kind: "target-class", scopeKey: "class-x", hosts: [], targetClass: "saas", stack: [], originEngagementIds: ["eng-1"] },
    };
    expectMemoryError("SCOPE_TOO_BROAD", () => assertScopeBinding(reScoped));
  });

  it("global-procedural target fact is rejected", () => {
    const unit = finalizeUnit(draftFinding("a fact about one target"), NOW);
    const reScoped: MemoryUnit = {
      ...unit,
      kind: "target-fact",
      scope: { kind: "global-procedural", scopeKey: "global", hosts: [], stack: [], originEngagementIds: ["eng-1"] },
    };
    expectMemoryError("SCOPE_TOO_BROAD", () => assertScopeBinding(reScoped));
  });

  it("target-derived claim under class scope is rejected (SCOPE_TOO_BROAD)", () => {
    const unit = finalizeUnit(draftFinding("the target says its WAF blocks everything"), NOW);
    const reScoped: MemoryUnit = {
      ...unit,
      kind: "target-derived-claim",
      provenance: { ...unit.provenance, sourceClass: "target-content" },
      contentClass: "target-derived-untrusted",
      scope: { kind: "target-class", scopeKey: "class-x", hosts: [], targetClass: "saas", stack: [], originEngagementIds: ["eng-1"] },
    };
    expectMemoryError("SCOPE_TOO_BROAD", () => assertScopeBinding(reScoped));
  });

  it("a tampered ledger line fails the hash check (STORE_CORRUPT)", () => {
    const unit = finalizeUnit(draftFinding("hash binds the record"), NOW);
    const line = JSON.stringify(unit);
    const tampered = line.replace("hash binds the record", "hash binds the record!");
    expectMemoryError("STORE_CORRUPT", () => parseUnitLine(tampered, 3, "units.jsonl"));
    assert.equal(parseUnitLine(line, 3, "units.jsonl").unitId, unit.unitId);
  });
});

describe("memory store (brief §11)", () => {
  it("first open bootstraps an empty store with a manifest", () => {
    const root = tempStoreRoot();
    const storeRoot = join(root, "memory");
    const paths = resolveMemoryPaths(storeRoot);
    const store = openMemoryStore(paths, NOW);
    assert.equal(store.bootstrapped, true);
    assert.equal(store.manifest.unitCount, 0);
    assert.ok(existsSync(paths.manifestPath));
    assert.ok(existsSync(paths.unitsPath));
    assert.deepEqual(store.listUnits(), []);
    const reopened = openMemoryStore(paths, NOW);
    assert.equal(reopened.bootstrapped, false);
    rmSync(root, { recursive: true, force: true });
  });

  it("corrupt manifest throws STORE_CORRUPT", () => {
    const root = tempStoreRoot();
    const paths = resolveMemoryPaths(join(root, "memory"));
    openMemoryStore(paths, NOW);
    writeFileSync(paths.manifestPath, "{ not json");
    expectMemoryError("STORE_CORRUPT", () => openMemoryStore(paths, NOW));
    rmSync(root, { recursive: true, force: true });
  });

  it("malformed units.jsonl line throws with the line number", () => {
    const root = tempStoreRoot();
    const paths = resolveMemoryPaths(join(root, "memory"));
    openMemoryStore(paths, NOW);
    appendFileSync(paths.unitsPath, "{ broken json\n");
    assert.throws(
      () => openMemoryStore(paths, NOW),
      (err: unknown) => {
        assert.ok(err instanceof MemoryError);
        assert.equal(err.code, "STORE_CORRUPT");
        assert.ok(err.message.includes(":1:"), `message names the line: ${err.message}`);
        return true;
      },
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("index mismatch throws STORE_INDEX_MISMATCH and reindex repairs with a receipt", () => {
    const root = tempStoreRoot();
    const paths = resolveMemoryPaths(join(root, "memory"));
    const store = openMemoryStore(paths, NOW);
    appendFinding(store, "index must agree with the ledger");
    const index = JSON.parse(readFileSync(paths.viewsIndexPath, "utf8")) as { dirs: Record<string, { totalUnits: number }> };
    const dir = Object.keys(index.dirs)[0]!;
    index.dirs[dir]!.totalUnits = 99;
    writeFileSync(paths.viewsIndexPath, JSON.stringify(index));
    expectMemoryError("STORE_INDEX_MISMATCH", () => openMemoryStore(paths, NOW));
    const receipt = reindexMemoryStore(paths, NOW);
    assert.ok(existsSync(receipt.receiptPath));
    assert.equal(receipt.unitsChecked, 1);
    const repaired = openMemoryStore(paths, NOW);
    assert.equal(repaired.listUnits().length, 1);
    rmSync(root, { recursive: true, force: true });
  });

  it("held lock throws STORE_LOCKED", () => {
    const root = tempStoreRoot();
    const paths = resolveMemoryPaths(join(root, "memory"));
    const store = openMemoryStore(paths, NOW);
    writeFileSync(paths.lockPath, `${JSON.stringify({ pid: 424242, at: new Date().toISOString() })}\n`, { flag: "wx" });
    assert.throws(
      () => store.withLock(() => "never"),
      (err: unknown) => {
        assert.ok(err instanceof MemoryError);
        assert.equal(err.code, "STORE_LOCKED");
        assert.ok(err.message.includes("424242"), `message names the holder: ${err.message}`);
        return true;
      },
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("L0/L1 budgets enforced (256/4000)", () => {
    const draft = draftFinding("x".repeat(1900));
    const { views: _v, hash: _h, ...viewInput } = finalizeUnit(draft, NOW);
    const views = generateUnitViews(viewInput);
    assert.ok(views.l0.length <= 256, `l0 is ${views.l0.length}`);
    const { views: _v2, hash: _h2, ...baseInput } = finalizeUnit(draftFinding("budget base"), NOW);
    const fatInput = {
      ...baseInput,
      claim: `budget case ${"z".repeat(1800)}`,
      proof: {
        state: "confirmed" as const,
        receipts: Array.from({ length: 6 }, (_, i) => ({
          kind: "evidence" as const,
          ref: `evidence/${"y".repeat(300)}-${i}.md`,
        })),
      },
    };
    expectMemoryError("VIEW_BUDGET_EXCEEDED", () => generateUnitViews(fatInput));
  });

  it("version sequencing is enforced and proposed units stay out of the active set", () => {
    const root = tempStoreRoot();
    const paths = resolveMemoryPaths(join(root, "memory"));
    const store = openMemoryStore(paths, NOW);
    const v1 = appendFinding(store, "sequencing holds", "proposed");
    assert.equal(store.listUnits().length, 0);
    assert.equal(store.listUnitsWithStatus()[0]?.status, "proposed");
    expectMemoryError("SCHEMA_INVALID", () =>
      store.appendUnitVersion(v1, { status: "active", by: "runner", reason: "replay", at: NOW }),
    );
    const draft2 = { ...draftFinding("sequencing holds"), version: 2, body: "revised detail" };
    const v2 = finalizeUnit(draft2, NOW);
    assert.equal(v2.unitId, v1.unitId);
    store.appendUnitVersion(v2, { status: "active", by: "runner", reason: "MECHANICAL_PROJECTION", at: NOW });
    assert.equal(store.listUnits()[0]?.body, "revised detail");
    assert.equal(store.manifest.unitCount, 1);
    assert.equal(store.manifest.versionCount, 2);
    rmSync(root, { recursive: true, force: true });
  });

  it("unscoped write against the store fails loud", () => {
    const root = tempStoreRoot();
    const paths = resolveMemoryPaths(join(root, "memory"));
    const store = openMemoryStore(paths, NOW);
    const draft = draftFinding("no hosts, no write");
    draft.scope = { ...draft.scope, hosts: [] };
    const unit = finalizeUnit(draft, NOW);
    expectMemoryError("SCHEMA_INVALID", () =>
      store.appendUnitVersion(unit, { status: "active", by: "runner", reason: "test", at: NOW }),
    );
    assert.equal(store.listUnits().length, 0);
    rmSync(root, { recursive: true, force: true });
  });

  it("archive sequences are per-engagement and never reused", () => {
    const root = tempStoreRoot();
    const paths = resolveMemoryPaths(join(root, "memory"));
    const store = openMemoryStore(paths, NOW);
    assert.equal(store.allocateArchiveSeq("eng-1"), 1);
    assert.equal(store.allocateArchiveSeq("eng-1"), 2);
    assert.equal(store.allocateArchiveSeq("eng-2"), 1);
    const reopened = openMemoryStore(paths, NOW);
    assert.equal(reopened.allocateArchiveSeq("eng-1"), 3);
    rmSync(root, { recursive: true, force: true });
  });

  it("directory view goes stale-but-readable below the 0.10 refresh threshold and refreshes at it", () => {
    const root = tempStoreRoot();
    const paths = resolveMemoryPaths(join(root, "memory"));
    const store = openMemoryStore(paths, NOW);
    let dirKey = "";
    for (let i = 0; i < 30; i += 1) {
      const unit = appendFinding(store, `bulk unit ${i} for threshold arithmetic`);
      dirKey = `scope/${unit.scope.scopeKey}`;
    }
    refreshDirectoryView(store, dirKey, NOW);
    // Two more activations: covered+pending = 32 > 20, pending/total = 2/32 < 0.10 → stale.
    appendFinding(store, "bulk unit 30 for threshold arithmetic");
    appendFinding(store, "bulk unit 31 for threshold arithmetic");
    const stale = ensureViews(store, [dirKey], NOW);
    assert.deepEqual(stale.staleDirs, [dirKey]);
    assert.deepEqual(stale.refreshedDirs, []);
    const overview = readFileSync(join(paths.viewsDir, "scope", dirKey.split("/")[1]!, ".overview.md"), "utf8");
    assert.ok(overview.length > 0, "stale view stays readable");
    // Two more: pending/total = 4/34 >= 0.10 → refresh.
    appendFinding(store, "bulk unit 32 for threshold arithmetic");
    appendFinding(store, "bulk unit 33 for threshold arithmetic");
    const refreshed = ensureViews(store, [dirKey], NOW);
    assert.deepEqual(refreshed.refreshedDirs, [dirKey]);
    assert.deepEqual(refreshed.staleDirs, []);
    rmSync(root, { recursive: true, force: true });
  });

  it("unit view hash mismatch regenerates via ensureViews", () => {
    const root = tempStoreRoot();
    const paths = resolveMemoryPaths(join(root, "memory"));
    const store = openMemoryStore(paths, NOW);
    const v1 = appendFinding(store, "projection follows the current version");
    const dirKey = `scope/${v1.scope.scopeKey}`;
    refreshDirectoryView(store, dirKey, NOW);
    const draft2 = { ...draftFinding("projection follows the current version"), version: 2, body: "version two detail" };
    const v2 = finalizeUnit(draft2, NOW);
    store.appendUnitVersion(v2, { status: "active", by: "runner", reason: "MECHANICAL_PROJECTION", at: NOW });
    const result = ensureViews(store, [dirKey], NOW);
    assert.ok(result.refreshedUnitIds.includes(v1.unitId), "stale projection regenerated");
    const projection = readFileSync(
      join(paths.viewsDir, "scope", v1.scope.scopeKey, "units", `${v1.unitId}.md`),
      "utf8",
    );
    assert.ok(projection.includes("version two detail"), "projection now renders the current version");
    rmSync(root, { recursive: true, force: true });
  });
});
