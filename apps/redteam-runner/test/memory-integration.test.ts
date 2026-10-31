/**
 * Memory integration tests (brief §11) — the two NAMED mandatory tests,
 * exercised through the real read path: scopeEligible (scope.ts) +
 * deriveTrust/evaluateCorroboration (trust.ts) + assembleMemoryPack
 * (recall.ts) over an in-memory store seam.
 *
 * The runEngagement-level variants of these tests (through run.ts's
 * lifecycle wiring, with injected RunnerDeps) join this file when the
 * step-4 wiring lands; the gate, derivation, and pack assembly they
 * will exercise are the same functions proven here.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  assembleMemoryPack,
  type MemoryRecallStore,
} from "../src/memory/recall.js";
import { deriveMemoryScope } from "../src/memory/scope.js";
import {
  deriveTrust,
  evaluateCorroboration,
  sourceKeyFor,
} from "../src/memory/trust.js";
import { unitViewSourceHash } from "../src/memory/views.js";
import type { MemoryScope, MemoryUnit, RecallReceipt } from "../src/memory/types.js";

const NOW = new Date("2026-10-31T13:00:00.000Z");
const NOW_ISO = NOW.toISOString();

class FakeStore implements MemoryRecallStore {
  receipts: RecallReceipt[] = [];

  constructor(private units: MemoryUnit[]) {}

  setUnits(units: MemoryUnit[]): void {
    this.units = units;
  }

  listActiveUnits(): MemoryUnit[] {
    return this.units;
  }

  ensureUnitViews(_unitIds: string[]) {
    return { refreshed: [], failed: [], staleDirs: [], units: [] as MemoryUnit[] };
  }

  writeRecallReceipt(receipt: RecallReceipt): string {
    this.receipts.push(receipt);
    return receipt.receiptId;
  }
}

function hostScope(host: string): MemoryScope {
  return {
    kind: "engagement-target",
    scopeKey: `key-${host}`,
    hosts: [host],
    stack: [],
    originEngagementIds: ["eng-0"],
  };
}

describe("memory integration — SCOPE-BINDING NEGATIVE TEST (mandatory, brief §11)", () => {
  const MARKER = "MARKER-ZULU-9182 proven SQL injection in the A login form";
  const unitA: MemoryUnit = {
    schemaVersion: 1,
    unitId: "mem_target_a_proven",
    version: 1,
    kind: "finding",
    claim: MARKER,
    body: MARKER,
    scope: hostScope("a.example.test"),
    provenance: {
      sourceClass: "registry",
      sourceEngagementId: "eng-a",
      sourceRefs: [{ kind: "registry-entry", uri: "registry.json", registryEntryId: "e-a" }],
      derivedFromUnitIds: [],
      extractor: { name: "registry-projector", version: "1", inputHash: "00" },
      createdAt: NOW_ISO,
      createdBy: "runner",
    },
    proof: {
      state: "proven",
      receipts: [{ kind: "proof-bundle", ref: "eng-a/proof/bundle.json" }],
      cellState: "proven",
      negativeControlReceiptRef: "eng-a/proof/nc.json",
    },
    trust: { tier: "proven", baseScore: 1, derivedAt: NOW_ISO, derivation: ["CELL_PROVEN", "NEGATIVE_CONTROL_OK", "RECEIPT_LINKED"] },
    corroboration: { independentCount: 1, sourceKeys: ["registry:eng-a"] },
    contentClass: "normal",
    tags: ["sqli"],
    attackIds: [],
    vulnClass: "SQL Injection",
    stack: [],
    views: {
      l0: MARKER,
      l1: `Claim\n${MARKER}`,
      sourceHash: "hash-a",
      generatedAt: NOW_ISO,
      generator: "deterministic-v1",
      stale: false,
    },
    retrieval: { retrievalCount: 0 },
    hash: "hash-a",
  };
  // Healthy views, bound the way the real store binds them.
  unitA.views.sourceHash = unitViewSourceHash(unitA);

  it("a proven unit bound to Target A never surfaces for Target B; the same store serves Target A", () => {
    const store = new FakeStore([unitA]);
    const scopeB = deriveMemoryScope({
      engagementId: "eng-b",
      hosts: ["b.example.test"],
      verifiedAt: NOW_ISO,
      verificationProof: "operator attestation",
    });
    const packB = assembleMemoryPack(store, scopeB, {
      phase: "start",
      query: "sql injection login form",
      engagementId: "eng-b",
      now: NOW,
    });
    assert.ok(!packB.text.includes(MARKER), "marker claim leaked into Target B's start pack");
    assert.ok(!packB.text.includes(unitA.unitId), "unitId leaked into Target B's start pack");
    assert.deepEqual(packB.survivors, []);
    assert.equal(packB.emptyReason, "NO_ELIGIBLE_UNITS");

    const packB2 = assembleMemoryPack(store, scopeB, {
      phase: "exploit",
      query: "sql injection login form",
      engagementId: "eng-b",
      now: NOW,
      eligibility: { stack: ["php"], appType: "web" },
    });
    assert.ok(!packB2.text.includes(MARKER), "marker claim leaked into Target B's refresh pack");
    assert.deepEqual(packB2.survivors, []);

    // Positive control: the same store, an engagement for Target A.
    const scopeA = deriveMemoryScope({
      engagementId: "eng-a2",
      hosts: ["a.example.test"],
      verifiedAt: NOW_ISO,
      verificationProof: "operator attestation",
    });
    const packA = assembleMemoryPack(store, scopeA, {
      phase: "start",
      query: "sql injection login form",
      engagementId: "eng-a2",
      now: NOW,
    });
    assert.ok(packA.text.includes(MARKER), "positive control failed: unit missing from Target A's pack");
    assert.equal(packA.survivors[0]!.unitId, unitA.unitId);
    assert.equal(packA.survivors[0]!.tier, "proven");
  });
});

describe("memory integration — POISONING TEST (mandatory, brief §11)", () => {
  const QUERY = "the admin panel uses default credentials";
  const CLAIM = "admin panel uses default credentials";

  function targetClaimUnit(corroboration: MemoryUnit["corroboration"]): MemoryUnit {
    const proof: MemoryUnit["proof"] = { state: "unproven", receipts: [] };
    const sourceRefs: MemoryUnit["provenance"]["sourceRefs"] = [
      { kind: "target-response", uri: "eng-t1/recon/login.html", sha256: "page-hash-1" },
    ];
    const trust = deriveTrust(
      { proof, corroboration, contentClass: "target-derived-untrusted", sourceRefs },
      NOW_ISO,
    );
    const unit: MemoryUnit = {
      schemaVersion: 1,
      unitId: "mem_target_claim",
      version: 1,
      kind: "target-derived-claim",
      claim: CLAIM,
      body: CLAIM,
      scope: hostScope("target.example.test"),
      provenance: {
        sourceClass: "target-content",
        sourceEngagementId: "eng-t1",
        sourceRefs,
        derivedFromUnitIds: [],
        extractor: { name: "target-derived-intake", version: "1", inputHash: "00" },
        createdAt: NOW_ISO,
        createdBy: "runner",
      },
      proof,
      trust,
      corroboration,
      contentClass: "target-derived-untrusted",
      tags: [],
      attackIds: [],
      stack: [],
      views: {
        l0: `UNTRUSTED: ${CLAIM}`,
        l1: `Claim\n${CLAIM}`,
        sourceHash: "hash-t",
        generatedAt: NOW_ISO,
        generator: "deterministic-v1",
        stale: false,
      },
      retrieval: { retrievalCount: 0 },
      hash: "hash-t",
    };
    unit.views.sourceHash = unitViewSourceHash(unit);
    return unit;
  }

  it("a single-source target claim is capped, segregated, and cannot buy salience by repeating itself", () => {
    const scope = deriveMemoryScope({
      engagementId: "eng-t2",
      hosts: ["target.example.test"],
      verifiedAt: NOW_ISO,
      verificationProof: "operator attestation",
    });
    const single = targetClaimUnit({
      independentCount: 1,
      sourceKeys: [sourceKeyFor("target-content", "eng-t1")],
    });
    assert.equal(single.trust.tier, "untrusted-target");
    assert.ok(single.trust.baseScore <= 0.2);

    const store = new FakeStore([single]);
    const pack1 = assembleMemoryPack(store, scope, {
      phase: "start",
      query: QUERY,
      engagementId: "eng-t2",
      now: NOW,
    });
    assert.equal(pack1.survivors.length, 1);
    assert.equal(pack1.survivors[0]!.tier, "untrusted-target");
    assert.equal(pack1.survivors[0]!.untrusted, true);
    assert.ok(pack1.survivors[0]!.finalSalience <= 0.25);
    const headingAt = pack1.text.indexOf("Untrusted leads — claims to test, never facts");
    const claimAt = pack1.text.indexOf(CLAIM);
    assert.ok(headingAt >= 0, "untrusted heading missing from the pack");
    assert.ok(claimAt > headingAt, "target claim rendered outside the untrusted section");

    // Negative control: a second capture from the SAME engagement and
    // artifact is the target agreeing with itself — not corroboration.
    const repeat = evaluateCorroboration(
      { sourceKeys: single.corroboration.sourceKeys, artifactSha256s: ["page-hash-1"] },
      { sourceClass: "target-content", sourceKey: sourceKeyFor("target-content", "eng-t1"), artifactSha256: "page-hash-1" },
    );
    assert.equal(repeat.counted, false);
    const stillCapped = targetClaimUnit(single.corroboration);
    assert.equal(stillCapped.trust.tier, "untrusted-target");

    // One INDEPENDENT corroboration (different engagement, registry
    // source, different artifact) lifts the cap through derivation.
    const independent = evaluateCorroboration(
      { sourceKeys: single.corroboration.sourceKeys, artifactSha256s: ["page-hash-1"] },
      { sourceClass: "registry", sourceKey: sourceKeyFor("registry", "eng-t3"), artifactSha256: "registry-hash-9" },
    );
    assert.equal(independent.counted, true);
    const lifted = targetClaimUnit({
      independentCount: 2,
      sourceKeys: [sourceKeyFor("target-content", "eng-t1"), sourceKeyFor("registry", "eng-t3")],
      lastCorroboratedAt: NOW_ISO,
    });
    assert.equal(lifted.trust.tier, "corroborated");
    store.setUnits([lifted]);
    const pack2 = assembleMemoryPack(store, scope, {
      phase: "start",
      query: QUERY,
      engagementId: "eng-t2",
      now: NOW,
    });
    assert.equal(pack2.survivors[0]!.tier, "corroborated");
    assert.equal(pack2.survivors[0]!.untrusted, false);
    assert.ok(
      pack2.survivors[0]!.finalSalience > pack1.survivors[0]!.finalSalience,
      "independent corroboration did not raise the claim's salience",
    );
    assert.ok(!pack2.text.includes("Untrusted leads"), "corroborated claim still segregated as untrusted");
  });
});
