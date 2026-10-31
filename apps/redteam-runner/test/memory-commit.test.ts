/**
 * Memory two-phase commit + approval/apply tests (brief §11).
 * Store/schema/scope tests live in memory-store.test.ts; trust/collapse
 * in memory-core.test.ts; recall-path integration in
 * memory-integration.test.ts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyDiff, approveDiff, readDiff, rejectDiff } from "../src/memory/apply.js";
import { commitEngagementMemory, type MemoryCommitInput } from "../src/memory/commit.js";
import { MemoryArchiveError, MemoryError } from "../src/memory/errors.js";
import { resolveMemoryPaths, type MemoryPaths } from "../src/memory/paths.js";
import { computeUnitId, parseUnitLine, sealDiff, sha256OfText, verifyDiffHash } from "../src/memory/schema.js";
import { deriveMemoryScope } from "../src/memory/scope.js";
import { finalizeUnit, openMemoryStore, type MemoryStore } from "../src/memory/store.js";
import type { MemoryEngagementReceipt, MemoryScope } from "../src/memory/types.js";
import type { ConfirmedFinding } from "../src/registry.js";
import type { ExperienceRecord } from "../src/harness2/experience-record.js";

const NOW = "2026-10-31T14:10:00.000Z";
const LATER = "2026-10-31T15:10:00.000Z";
const HOST = "a.example.test";

interface Fixture {
  paths: MemoryPaths;
  store: MemoryStore;
  engagementDir: string;
  scope: MemoryScope;
}

function fixture(engagementId = "eng-1", withEvents = true): Fixture {
  const base = mkdtempSync(join(tmpdir(), "memory-commit-"));
  const paths = resolveMemoryPaths(join(base, "memory"));
  const store = openMemoryStore(paths, NOW);
  const engagementDir = join(base, "engagement");
  mkdirSync(engagementDir, { recursive: true });
  if (withEvents) {
    writeFileSync(
      join(engagementDir, "events.jsonl"),
      [
        JSON.stringify({ phase: "authorize", actor: "runner", action: "verify", result: "ok" }),
        JSON.stringify({ phase: "plan", actor: "coordinator", action: "plan", result: "ok" }),
        "",
      ].join("\n"),
    );
    writeFileSync(join(engagementDir, "steps.jsonl"), "{}\n");
    writeFileSync(join(engagementDir, "state.json"), "{}\n");
  }
  const scope = deriveMemoryScope({
    engagementId,
    hosts: [HOST],
    verifiedAt: NOW,
    verificationProof: "dns-txt attestation",
  });
  return { paths, store, engagementDir, scope };
}

function confirmedEntry(overrides: Partial<ConfirmedFinding> = {}): ConfirmedFinding {
  return {
    id: "vuln-0001",
    date: "2026-10-31",
    engagementId: "eng-1",
    kind: "confirmed",
    target: { host: HOST, stack: ["node"], appType: "api" },
    vulnClass: "IDOR",
    technique: "increment object id",
    attackId: "T1190",
    payloadPattern: "GET /api/orders/{id+1}",
    evidenceRef: "evidence/p7.md",
    severity: "high",
    ...overrides,
  };
}

function commitInput(fx: Fixture, overrides: Partial<MemoryCommitInput> = {}): MemoryCommitInput {
  return {
    store: fx.store,
    paths: fx.paths,
    engagementId: "eng-1",
    engagementDir: fx.engagementDir,
    target: HOST,
    mode: "red",
    objective: "assess the api",
    outcome: "complete",
    scope: fx.scope,
    scopeRecord: { hosts: [HOST], roeScope: [HOST], verificationProof: "dns-txt attestation", verifiedAt: NOW },
    registryEntries: [],
    recallReceiptIds: [],
    nowIso: NOW,
    ...overrides,
  };
}

/** Narrow a commit receipt to its success variant (Phase 2 failures carry only status+error). */
function okCommit(receipt: MemoryEngagementReceipt) {
  const commit = receipt.commit;
  if ("error" in commit) assert.fail(`commit failed: ${commit.error}`);
  return commit;
}

function archiveDir(paths: MemoryPaths, engagementId: string, seq = 1): string {
  return join(paths.archivesDir, engagementId, `archive-${String(seq).padStart(4, "0")}`);
}

/**
 * A fresh store instance over the same root. applyDiff opens its own
 * instance (as the CLI does), and MemoryStore state is per-instance —
 * post-apply assertions must read through a reopened store.
 */
function reopen(fx: Fixture): MemoryStore {
  return openMemoryStore(fx.paths, LATER);
}

function expectMemoryError(code: string, fn: () => unknown, messagePart?: string): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof MemoryError, `expected MemoryError, got ${String(err)}`);
    assert.equal(err.code, code);
    if (messagePart) assert.ok(err.message.includes(messagePart), `message should mention ${messagePart}: ${err.message}`);
    return true;
  });
}

const CLAIM = { text: "The status page says the admin API needs no authentication.", host: HOST, sourceUri: "capture/status.html" };

describe("memory commit — phase 1 archive (§7.2)", () => {
  it("archives the raw record first; manifest hashes match the copies; diff lands in both homes", () => {
    const fx = fixture();
    const receipt = commitEngagementMemory(commitInput(fx, { registryEntries: [confirmedEntry()] }));
    assert.equal(receipt.commit.status, "applied");
    assert.equal(okCommit(receipt).autoApplied, 1);
    const dir = archiveDir(fx.paths, "eng-1");
    const sourceEvents = readFileSync(join(fx.engagementDir, "events.jsonl"), "utf8");
    assert.equal(readFileSync(join(dir, "events.jsonl"), "utf8"), sourceEvents);
    const manifest = JSON.parse(readFileSync(join(dir, "archive-manifest.json"), "utf8")) as {
      files: { name: string; present: boolean; sha256?: string }[];
    };
    const eventsEntry = manifest.files.find((f) => f.name === "events.jsonl");
    assert.equal(eventsEntry?.present, true);
    assert.equal(eventsEntry?.sha256, sha256OfText(sourceEvents));
    assert.ok(existsSync(join(dir, ".done")), "archive carries the .done marker");
    assert.ok(existsSync(join(dir, "summary.md")), "fixed-template summary written");
    // The diff exists in proposals/ and as the archive copy, byte-identical.
    const diffId = okCommit(receipt).diffId;
    const inProposals = readFileSync(join(fx.paths.proposalsDir, `${diffId}.json`), "utf8");
    assert.equal(readFileSync(join(dir, "memory_diff.json"), "utf8"), inProposals);
    assert.equal(verifyDiffHash(readDiff(fx.paths, diffId)), true);
    // The projected finding is active in the store.
    assert.equal(fx.store.listUnits().length, 1);
    assert.equal(fx.store.listUnits()[0]!.kind, "finding");
  });

  it("missing events.jsonl fails Phase 1 loud (MemoryArchiveError) and marks the archive failed", () => {
    const fx = fixture("eng-1", false);
    assert.throws(
      () => commitEngagementMemory(commitInput(fx)),
      (err: unknown) => err instanceof MemoryArchiveError,
    );
    const status = JSON.parse(readFileSync(join(archiveDir(fx.paths, "eng-1"), "commit-status.json"), "utf8")) as { phase: string };
    assert.equal(status.phase, "archive-failed");
    assert.equal(existsSync(join(archiveDir(fx.paths, "eng-1"), "summary.md")), false, "no summary on archive failure");
    assert.equal(existsSync(join(archiveDir(fx.paths, "eng-1"), "memory_diff.json")), false, "no diff on archive failure");
  });

  it("nothing to extract still writes an all-zero diff with a verifiable sha256", () => {
    const fx = fixture();
    const receipt = commitEngagementMemory(commitInput(fx));
    assert.equal(receipt.commit.status, "applied");
    assert.deepEqual(
      { a: okCommit(receipt).autoApplied, p: okCommit(receipt).proposed, s: okCommit(receipt).skipped },
      { a: 0, p: 0, s: 0 },
    );
    const diff = readDiff(fx.paths, okCommit(receipt).diffId);
    assert.equal(verifyDiffHash(diff), true);
    assert.deepEqual(diff.counts, { autoApplied: 0, proposed: 0, skipped: 0 });
  });
});

describe("memory commit — projection lanes (§7.2)", () => {
  it("re-projection of identical content dedupes as DUPLICATE_NO_CHANGE (no new version)", () => {
    const fx = fixture();
    commitEngagementMemory(commitInput(fx, { registryEntries: [confirmedEntry()] }));
    const second = commitEngagementMemory(commitInput(fx, { registryEntries: [confirmedEntry()], nowIso: LATER }));
    const diff = readDiff(fx.paths, okCommit(second).diffId);
    assert.ok(diff.skipped.some((s) => s.reason === "DUPLICATE_NO_CHANGE"), "second commit records the dedupe skip");
    assert.equal(fx.store.listUnits()[0]!.version, 1);
  });

  it("an independent re-projection (new engagement, new evidence) lands as a corroboration version", () => {
    const fx = fixture();
    commitEngagementMemory(commitInput(fx, { registryEntries: [confirmedEntry()] }));
    const fx2scope = deriveMemoryScope({ engagementId: "eng-2", hosts: [HOST], verifiedAt: NOW, verificationProof: "dns-txt attestation" });
    const second = commitEngagementMemory(
      commitInput(fx, {
        engagementId: "eng-2",
        scope: fx2scope,
        registryEntries: [confirmedEntry({ engagementId: "eng-2", evidenceRef: "evidence/p9.md" })],
        nowIso: LATER,
      }),
    );
    assert.equal(okCommit(second).autoApplied, 1);
    const unit = fx.store.listUnits()[0]!;
    assert.equal(unit.version, 2);
    assert.equal(unit.corroboration.independentCount, 1);
    assert.equal(unit.corroboration.sourceKeys.length, 2);
  });

  it("a superseded experience record is recorded as DELETE_NOT_SUPPORTED_V1 — v1 has no delete", () => {
    const fx = fixture();
    const record: ExperienceRecord = {
      date: "2026-10-30",
      cycleId: "cycle-7",
      targetClass: "node-api",
      changed: "Retry budget raised to 3",
      why: "flaky target",
      measuredEffect: "fewer halts",
      status: { kind: "superseded", by: "cycle-8" },
    };
    const receipt = commitEngagementMemory(
      commitInput(fx, { experience: { records: [record], skipped: 0, files: [{ uri: "EXPERIENCE.md", sha256: "a".repeat(64) }] } }),
    );
    const diff = readDiff(fx.paths, okCommit(receipt).diffId);
    assert.ok(diff.skipped.some((s) => s.reason === "DELETE_NOT_SUPPORTED_V1"), "the delete request is a visible skip, not a silent drop");
    assert.equal(fx.store.listUnits().length, 0);
  });

  it("a hand-written diff carrying a delete op is refused at read time", () => {
    const fx = fixture();
    const raw = {
      diffId: "eng-9-0001",
      engagementId: "eng-9",
      archiveUri: "memory://archives/eng-9/archive-0001",
      createdAt: NOW,
      inputHashes: { events: "b".repeat(64), registryEntries: [], experienceFiles: [] },
      autoApplied: [],
      proposed: [{ opId: "op-001", type: "delete", unitId: "mem_whatever" }],
      skipped: [],
      counts: { autoApplied: 0, proposed: 1, skipped: 0 },
      audit: { legacyExperienceSkipped: 0, extractorVersions: {} },
      status: "proposed",
      sha256: "a".repeat(64),
    };
    writeFileSync(join(fx.paths.proposalsDir, "eng-9-0001.json"), `${JSON.stringify(raw, null, 2)}\n`);
    expectMemoryError("SCHEMA_INVALID", () => readDiff(fx.paths, "eng-9-0001"), "DELETE_NOT_SUPPORTED_V1");
  });
});

describe("memory apply — approval gate (§7.3)", () => {
  function proposedClaimDiff(fx: Fixture): string {
    const receipt = commitEngagementMemory(commitInput(fx, { targetDerivedClaims: [CLAIM] }));
    assert.equal(receipt.commit.status, "proposed");
    assert.equal(okCommit(receipt).proposed, 1);
    return okCommit(receipt).diffId;
  }

  it("apply without an approval record refuses and activates nothing", () => {
    const fx = fixture();
    const diffId = proposedClaimDiff(fx);
    expectMemoryError("SCHEMA_INVALID", () => applyDiff(fx.paths, diffId, LATER), "approval");
    assert.equal(reopen(fx).listUnits().length, 0);
  });

  it("approve + apply activates the unit; approval does NOT raise a target-derived unit's trust", () => {
    const fx = fixture();
    const diffId = proposedClaimDiff(fx);
    approveDiff(fx.paths, diffId, { operator: "carlos-test", nowIso: LATER });
    const receipt = applyDiff(fx.paths, diffId, LATER);
    assert.equal(receipt.applied.length, 1);
    assert.equal(receipt.skipped.length, 0);
    const unit = reopen(fx).listUnits()[0]!;
    assert.equal(unit.kind, "target-derived-claim");
    assert.equal(unit.trust.tier, "untrusted-target");
    assert.ok(unit.trust.baseScore <= 0.2, `target-derived cap holds after approval (baseScore ${unit.trust.baseScore})`);
    assert.equal(readDiff(fx.paths, diffId).status, "applied");
  });

  it("a diff tampered after approval is refused (the approval binds the sha256)", () => {
    const fx = fixture();
    const diffId = proposedClaimDiff(fx);
    approveDiff(fx.paths, diffId, { operator: "carlos-test", nowIso: LATER });
    const path = join(fx.paths.proposalsDir, `${diffId}.json`);
    const bytes = readFileSync(path, "utf8").replace("admin API needs no authentication", "admin API is fully locked down");
    writeFileSync(path, bytes);
    expectMemoryError("SCHEMA_INVALID", () => applyDiff(fx.paths, diffId, LATER));
    assert.equal(reopen(fx).listUnits().length, 0);
  });

  it("reject flips the diff to rejected, changes no unit, and blocks apply", () => {
    const fx = fixture();
    const diffId = proposedClaimDiff(fx);
    rejectDiff(fx.paths, diffId, { operator: "carlos-test", nowIso: LATER });
    assert.equal(readDiff(fx.paths, diffId).status, "rejected");
    expectMemoryError("SCHEMA_INVALID", () => applyDiff(fx.paths, diffId, LATER));
    assert.equal(reopen(fx).listUnits().length, 0);
  });

  it("approve + apply of a supersede appends a new version; the old version's bytes stay in the ledger", () => {
    const fx = fixture();
    // Seed an active v1 finding through the store directly.
    const scope = fx.scope;
    const draft = {
      schemaVersion: 1 as const,
      unitId: computeUnitId(scope.scopeKey, "finding", "IDOR confirmed on a.example.test", "registry-entry:vuln-0001"),
      kind: "finding" as const,
      claim: "IDOR confirmed on a.example.test",
      body: "v1 body",
      scope,
      provenance: {
        sourceClass: "registry" as const,
        sourceEngagementId: "eng-1",
        sourceRefs: [{ kind: "registry-entry" as const, uri: "engagements/registry.json", registryEntryId: "vuln-0001" }],
        derivedFromUnitIds: [],
        extractor: { name: "registry-projector", version: "1", inputHash: "h1" },
        createdAt: NOW,
        createdBy: "runner",
      },
      proof: { state: "confirmed" as const, receipts: [{ kind: "registry-entry" as const, ref: "evidence/p7.md" }], registryEntryId: "vuln-0001" },
      corroboration: { independentCount: 0, sourceKeys: ["registry:eng-1"] },
      contentClass: "normal" as const,
      tags: ["idor"],
      attackIds: [],
      vulnClass: "IDOR",
      stack: [],
    };
    const v1 = finalizeUnit(draft, NOW);
    fx.store.appendUnitVersion(v1, { status: "active", by: "runner", reason: "MECHANICAL_PROJECTION", at: NOW });
    const v2 = finalizeUnit({ ...draft, version: 2, body: "v2 body with the payload pattern" }, LATER);
    const diff = sealDiff({
      diffId: "eng-1-0099",
      engagementId: "eng-1",
      archiveUri: "memory://archives/eng-1/archive-0099",
      createdAt: LATER,
      inputHashes: { events: "b".repeat(64), registryEntries: [], experienceFiles: [] },
      autoApplied: [],
      proposed: [{ opId: "op-001", type: "supersede", unitId: v1.unitId, baseVersion: 1, baseHash: v1.hash, unit: v2 }],
      skipped: [],
      counts: { autoApplied: 0, proposed: 1, skipped: 0 },
      audit: { legacyExperienceSkipped: 0, extractorVersions: {} },
      status: "proposed",
    });
    writeFileSync(join(fx.paths.proposalsDir, "eng-1-0099.json"), `${JSON.stringify(diff, null, 2)}\n`);
    approveDiff(fx.paths, "eng-1-0099", { operator: "carlos-test", nowIso: LATER });
    const receipt = applyDiff(fx.paths, "eng-1-0099", LATER);
    assert.equal(receipt.applied.length, 1);
    assert.equal(reopen(fx).getUnit(v1.unitId)!.version, 2);
    // The v1 ledger line is untouched: history is append-only.
    const lines = readFileSync(fx.paths.unitsPath, "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    assert.equal(parseUnitLine(lines[0]!, 1, fx.paths.unitsPath).hash, v1.hash);
  });

  it("a supersede whose base no longer matches is skipped STALE_BASE, never forced", () => {
    const fx = fixture();
    const diffId = proposedClaimDiff(fx);
    const createOp = readDiff(fx.paths, diffId).proposed[0]!;
    assert.equal(createOp.type, "create");
    if (createOp.type !== "create") return;
    // Activate the create first so the supersede has something to be stale against.
    approveDiff(fx.paths, diffId, { operator: "carlos-test", nowIso: LATER });
    applyDiff(fx.paths, diffId, LATER);
    const active = reopen(fx).listUnits()[0]!;
    const stale = sealDiff({
      diffId: "eng-1-0100",
      engagementId: "eng-1",
      archiveUri: "memory://archives/eng-1/archive-0100",
      createdAt: LATER,
      inputHashes: { events: "b".repeat(64), registryEntries: [], experienceFiles: [] },
      autoApplied: [],
      proposed: [
        {
          opId: "op-001",
          type: "supersede",
          unitId: active.unitId,
          baseVersion: 1,
          baseHash: "0".repeat(64),
          unit: { ...createOp.unit, version: 2 },
        },
      ],
      skipped: [],
      counts: { autoApplied: 0, proposed: 1, skipped: 0 },
      audit: { legacyExperienceSkipped: 0, extractorVersions: {} },
      status: "proposed",
    });
    writeFileSync(join(fx.paths.proposalsDir, "eng-1-0100.json"), `${JSON.stringify(stale, null, 2)}\n`);
    approveDiff(fx.paths, "eng-1-0100", { operator: "carlos-test", nowIso: LATER });
    const receipt = applyDiff(fx.paths, "eng-1-0100", LATER);
    assert.equal(receipt.applied.length, 0);
    assert.deepEqual(receipt.skipped, [{ opId: "op-001", reason: "STALE_BASE" }]);
    assert.equal(reopen(fx).getUnit(active.unitId)!.version, 1);
  });

  it("retire removes the unit from active listings but keeps it in the audit listing", () => {
    const fx = fixture();
    commitEngagementMemory(commitInput(fx, { registryEntries: [confirmedEntry()] }));
    const active = fx.store.listUnits()[0]!;
    const diff = sealDiff({
      diffId: "eng-1-0101",
      engagementId: "eng-1",
      archiveUri: "memory://archives/eng-1/archive-0101",
      createdAt: LATER,
      inputHashes: { events: "b".repeat(64), registryEntries: [], experienceFiles: [] },
      autoApplied: [],
      proposed: [{ opId: "op-001", type: "retire", unitId: active.unitId, baseVersion: 1, baseHash: active.hash, reason: "operator retired a stale finding" }],
      skipped: [],
      counts: { autoApplied: 0, proposed: 1, skipped: 0 },
      audit: { legacyExperienceSkipped: 0, extractorVersions: {} },
      status: "proposed",
    });
    writeFileSync(join(fx.paths.proposalsDir, "eng-1-0101.json"), `${JSON.stringify(diff, null, 2)}\n`);
    approveDiff(fx.paths, "eng-1-0101", { operator: "carlos-test", nowIso: LATER });
    const receipt = applyDiff(fx.paths, "eng-1-0101", LATER);
    assert.equal(receipt.applied.length, 1);
    const after = reopen(fx);
    assert.equal(after.listUnits().length, 0, "retired units leave the recall-facing listing");
    const audit = after.listUnitsWithStatus();
    assert.equal(audit.length, 1);
    assert.equal(audit[0]!.status, "retired");
  });
});
