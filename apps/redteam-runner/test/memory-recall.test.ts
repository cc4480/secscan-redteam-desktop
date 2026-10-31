/**
 * Memory recall tests (brief §7.1/§6.5/§8 row 9) against an in-memory
 * store seam. The mandatory scope-binding and poisoning tests live in
 * memory-integration.test.ts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MemoryError } from "../src/memory/errors.js";
import {
  assembleMemoryPack,
  decayFactor,
  type MemoryRecallStore,
} from "../src/memory/recall.js";
import { unitViewSourceHash } from "../src/memory/views.js";
import { deriveMemoryScope } from "../src/memory/scope.js";
import type { MemoryUnit, RecallReceipt } from "../src/memory/types.js";

const NOW = new Date("2026-10-31T13:00:00.000Z");
const NOW_ISO = NOW.toISOString();

class FakeStore implements MemoryRecallStore {
  receipts: RecallReceipt[] = [];
  viewResult: { refreshed: string[]; failed: string[]; staleDirs: { dir: string; pendingUnitChanges: number }[]; units: MemoryUnit[] } =
    { refreshed: [], failed: [], staleDirs: [], units: [] };

  constructor(private units: MemoryUnit[]) {}

  setUnits(units: MemoryUnit[]): void {
    this.units = units;
  }

  listActiveUnits(): MemoryUnit[] {
    return this.units;
  }

  ensureUnitViews(_unitIds: string[]) {
    return this.viewResult;
  }

  writeRecallReceipt(receipt: RecallReceipt): string {
    this.receipts.push(receipt);
    return receipt.receiptId;
  }
}

function makeUnit(overrides: Partial<MemoryUnit> & { unitId: string }): MemoryUnit {
  const claim = overrides.claim ?? "generic lesson about the target";
  const unit: MemoryUnit = {
    schemaVersion: 1,
    version: 1,
    kind: "trajectory-lesson",
    claim,
    body: claim,
    scope: {
      kind: "engagement-target",
      scopeKey: "target-example-test-ab12",
      hosts: ["target.example.test"],
      stack: [],
      originEngagementIds: ["eng-0"],
    },
    provenance: {
      sourceClass: "trajectory",
      sourceEngagementId: "eng-0",
      sourceRefs: [{ kind: "trajectory", uri: "eng-0/trajectory.json", sha256: "aa" }],
      derivedFromUnitIds: [],
      extractor: { name: "trajectory-projector", version: "1", inputHash: "00" },
      createdAt: NOW_ISO,
      createdBy: "runner",
    },
    proof: { state: "unproven", receipts: [] },
    trust: { tier: "single-source", baseScore: 0.45, derivedAt: NOW_ISO, derivation: ["SINGLE_SOURCE"] },
    corroboration: { independentCount: 1, sourceKeys: ["trajectory:eng-0"] },
    contentClass: "normal",
    tags: [],
    attackIds: [],
    stack: [],
    views: {
      l0: claim.slice(0, 256),
      l1: `Claim\n${claim}`,
      sourceHash: "hash-1",
      generatedAt: NOW_ISO,
      generator: "deterministic-v1",
      stale: false,
    },
    retrieval: { retrievalCount: 0 },
    hash: "hash-1",
    ...overrides,
  };
  // Default fixtures carry healthy views: bind sourceHash to the record
  // the way the real store does. Caller-supplied views stay as given
  // (the stale-view tests depend on their bogus sourceHash).
  if (!overrides.views) unit.views.sourceHash = unitViewSourceHash(unit);
  return unit;
}

const scope = deriveMemoryScope({
  engagementId: "eng-9",
  hosts: ["target.example.test"],
  verifiedAt: NOW_ISO,
  verificationProof: "operator attestation",
});

describe("memory recall (brief §7.1)", () => {
  it("empty store yields an explicit NO_ELIGIBLE_UNITS pack and a receipt", () => {
    const store = new FakeStore([]);
    const pack = assembleMemoryPack(store, scope, {
      phase: "start",
      query: "anything",
      engagementId: "eng-9",
      now: NOW,
    });
    assert.equal(pack.emptyReason, "NO_ELIGIBLE_UNITS");
    assert.match(pack.text, /no eligible prior memory/i);
    assert.match(pack.text, /reason NO_ELIGIBLE_UNITS/);
    assert.equal(store.receipts.length, 1);
    assert.equal(store.receipts[0]!.emptyReason, "NO_ELIGIBLE_UNITS");
    assert.equal(store.receipts[0]!.receiptId, "eng-9-start");
  });

  it("a bad budget fails loud naming the variable", () => {
    const store = new FakeStore([]);
    assert.throws(
      () =>
        assembleMemoryPack(store, scope, {
          phase: "start",
          query: "q",
          engagementId: "eng-9",
          budget: 99,
          now: NOW,
        }),
      (err: unknown) =>
        err instanceof MemoryError && err.code === "SCHEMA_INVALID" && /REDTEAM_MEMORY_BUDGET/.test(err.message),
    );
  });

  it("decay halves trajectory salience on the 90-day curve and is receipted", () => {
    const old = makeUnit({
      unitId: "mem_old",
      claim: "gateway retries lesson learned from the march outage postmortem",
      provenance: {
        sourceClass: "trajectory",
        sourceEngagementId: "eng-old",
        sourceRefs: [{ kind: "trajectory", uri: "eng-old/trajectory.json", sha256: "bb" }],
        derivedFromUnitIds: [],
        extractor: { name: "trajectory-projector", version: "1", inputHash: "00" },
        createdAt: "2026-04-14T13:00:00.000Z", // 200 days before NOW
        createdBy: "runner",
      },
      corroboration: { independentCount: 1, sourceKeys: ["trajectory:eng-old"] },
    });
    const fresh = makeUnit({
      unitId: "mem_new",
      claim: "gateway retries lesson confirmed again in october exercises",
    });
    // The factor itself: 2^(-200/90) ≈ 0.2143 for base 0.45 (< 0.7, >= 0.3).
    const factor = decayFactor(old, NOW);
    assert.ok(Math.abs(factor - Math.pow(2, -200 / 90)) < 1e-9, `factor ${factor}`);
    assert.equal(decayFactor(fresh, NOW), 1);

    const store = new FakeStore([old, fresh]);
    const pack = assembleMemoryPack(store, scope, {
      phase: "exploit",
      query: "gateway retries lesson",
      engagementId: "eng-9",
      now: NOW,
    });
    assert.deepEqual(
      pack.survivors.map((s) => s.unitId),
      ["mem_new", "mem_old"],
    );
    assert.deepEqual(store.receipts[0]!.decayed, ["mem_old"]);
  });

  it("proof-tier and operator units never decay", () => {
    const proven = makeUnit({
      unitId: "mem_proven_old",
      provenance: {
        sourceClass: "registry",
        sourceEngagementId: "eng-old",
        sourceRefs: [{ kind: "registry-entry", uri: "registry.json", registryEntryId: "e1" }],
        derivedFromUnitIds: [],
        extractor: { name: "registry-projector", version: "1", inputHash: "00" },
        createdAt: "2025-01-01T00:00:00.000Z",
        createdBy: "runner",
      },
      trust: { tier: "proven", baseScore: 1, derivedAt: NOW_ISO, derivation: ["CELL_PROVEN"] },
    });
    assert.equal(decayFactor(proven, NOW), 1);
    const strongLesson = makeUnit({
      unitId: "mem_strong",
      trust: { tier: "killed", baseScore: 0.8, derivedAt: NOW_ISO, derivation: ["KILLING_OBSERVATION_LINKED"] },
      provenance: {
        sourceClass: "trajectory",
        sourceEngagementId: "eng-old",
        sourceRefs: [{ kind: "trajectory", uri: "eng-old/trajectory.json" }],
        derivedFromUnitIds: [],
        extractor: { name: "trajectory-projector", version: "1", inputHash: "00" },
        createdAt: "2025-01-01T00:00:00.000Z",
        createdBy: "runner",
      },
    });
    assert.equal(decayFactor(strongLesson, NOW), 1); // baseScore >= 0.7 exemption
  });

  it("a stale view that cannot be refreshed excludes the candidate (VIEW_STALE)", () => {
    const stale = makeUnit({ unitId: "mem_stale", views: {
      l0: "stale", l1: "stale", sourceHash: "other-hash", generatedAt: NOW_ISO,
      generator: "deterministic-v1", stale: true,
    } });
    const store = new FakeStore([stale]);
    store.viewResult = { refreshed: [], failed: ["mem_stale"], staleDirs: [], units: [] };
    const pack = assembleMemoryPack(store, scope, {
      phase: "start",
      query: "generic lesson",
      engagementId: "eng-9",
      now: NOW,
    });
    assert.deepEqual(pack.survivors, []);
    assert.match(pack.text, /reason VIEW_STALE/);
    assert.deepEqual(store.receipts[0]!.viewStaleExcluded, ["mem_stale"]);
  });

  it("a refreshed stale view rejoins the pool and is receipted", () => {
    const stale = makeUnit({ unitId: "mem_fixed", views: {
      l0: "old l0", l1: "old l1", sourceHash: "other-hash", generatedAt: NOW_ISO,
      generator: "deterministic-v1", stale: true,
    } });
    const refreshed = makeUnit({ unitId: "mem_fixed" });
    const store = new FakeStore([stale]);
    store.viewResult = { refreshed: ["mem_fixed"], failed: [], staleDirs: [], units: [refreshed] };
    const pack = assembleMemoryPack(store, scope, {
      phase: "start",
      query: "generic lesson",
      engagementId: "eng-9",
      now: NOW,
    });
    assert.deepEqual(pack.survivors.map((s) => s.unitId), ["mem_fixed"]);
    assert.deepEqual(store.receipts[0]!.viewsRefreshed, ["mem_fixed"]);
  });
});
