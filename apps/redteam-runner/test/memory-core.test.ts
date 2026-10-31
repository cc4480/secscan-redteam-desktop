/**
 * Memory core tests (brief §11) — trust derivation, the collapse
 * ranking, and the scope gate. Schema/store/commit sections join this
 * file with the files they test.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MemoryError } from "../src/memory/errors.js";
import {
  collapseCandidates,
  scoreCandidates,
  type CollapseCandidate,
} from "../src/memory/collapse.js";
import { assertScopeBinding, deriveMemoryScope, scopeEligible } from "../src/memory/scope.js";
import { deriveTrust, evaluateCorroboration } from "../src/memory/trust.js";
import type {
  MemoryScope,
  MemoryUnit,
  TrustDerivationInput,
} from "../src/memory/types.js";

const NOW = "2026-10-31T13:00:00.000Z";

function trustInput(overrides: Partial<TrustDerivationInput>): TrustDerivationInput {
  return {
    proof: { state: "unproven", receipts: [] },
    corroboration: { independentCount: 1, sourceKeys: ["trajectory:eng-1"] },
    contentClass: "normal",
    sourceRefs: [{ kind: "trajectory", uri: "eng-1/trajectory.json" }],
    ...overrides,
  };
}

describe("memory trust derivation (brief §4.3)", () => {
  it("proven requires cell proven + negative-control receipt", () => {
    const trust = deriveTrust(
      trustInput({
        proof: {
          state: "proven",
          receipts: [{ kind: "proof-bundle", ref: "eng-1/proof/bundle.json" }],
          cellState: "proven",
          negativeControlReceiptRef: "eng-1/proof/negative-control.json",
        },
      }),
      NOW,
    );
    assert.equal(trust.tier, "proven");
    assert.equal(trust.baseScore, 1.0);
    assert.ok(trust.derivation.includes("CELL_PROVEN"));
    assert.ok(trust.derivation.includes("NEGATIVE_CONTROL_OK"));
  });

  it("proven claim without receipts throws TRUST_OVERCLAIM", () => {
    assert.throws(
      () =>
        deriveTrust(
          trustInput({
            proof: { state: "proven", receipts: [], cellState: "proven", negativeControlReceiptRef: "nc" },
          }),
          NOW,
        ),
      (err: unknown) => err instanceof MemoryError && err.code === "TRUST_OVERCLAIM",
    );
  });

  it("proven claim without a negative control throws TRUST_OVERCLAIM", () => {
    assert.throws(
      () =>
        deriveTrust(
          trustInput({
            proof: {
              state: "proven",
              receipts: [{ kind: "proof-bundle", ref: "eng-1/proof/bundle.json" }],
              cellState: "detected",
            },
          }),
          NOW,
        ),
      (err: unknown) => err instanceof MemoryError && err.code === "TRUST_OVERCLAIM",
    );
  });

  it("registry confirmed + evidenceRef derives confirmed 0.85", () => {
    const trust = deriveTrust(
      trustInput({
        proof: {
          state: "confirmed",
          receipts: [{ kind: "registry-entry", ref: "entry-9" }],
          registryEntryId: "entry-9",
        },
        sourceRefs: [{ kind: "registry-entry", uri: "registry.json", registryEntryId: "entry-9" }],
      }),
      NOW,
    );
    assert.equal(trust.tier, "confirmed");
    assert.equal(trust.baseScore, 0.85);
  });

  it("confirmed claim without receipts throws TRUST_OVERCLAIM", () => {
    assert.throws(
      () => deriveTrust(trustInput({ proof: { state: "confirmed", receipts: [] } }), NOW),
      (err: unknown) => err instanceof MemoryError && err.code === "TRUST_OVERCLAIM",
    );
  });

  it("killed derives killed 0.80", () => {
    const trust = deriveTrust(
      trustInput({
        proof: {
          state: "killed",
          receipts: [{ kind: "registry-entry", ref: "entry-10" }],
          registryEntryId: "entry-10",
        },
      }),
      NOW,
    );
    assert.equal(trust.tier, "killed");
    assert.equal(trust.baseScore, 0.8);
  });

  it("deferred never exceeds single-source", () => {
    const trust = deriveTrust(
      trustInput({
        proof: { state: "deferred", receipts: [{ kind: "evidence", ref: "eng-1/evidence.txt" }] },
        corroboration: { independentCount: 5, sourceKeys: ["registry:a", "operator:carlos", "registry:b", "experience:c", "registry:d"] },
      }),
      NOW,
    );
    assert.equal(trust.tier, "single-source");
    assert.equal(trust.baseScore, 0.45);
    assert.ok(trust.derivation.includes("DEFERRED_NOT_CONFIRMED"));
  });

  it("two independent corroborations derive corroborated 0.65", () => {
    const trust = deriveTrust(
      trustInput({
        corroboration: { independentCount: 2, sourceKeys: ["trajectory:eng-1", "registry:eng-2"] },
      }),
      NOW,
    );
    assert.equal(trust.tier, "corroborated");
    assert.equal(trust.baseScore, 0.65);
  });

  it("target-derived single source is capped at untrusted-target 0.20", () => {
    const trust = deriveTrust(
      trustInput({
        contentClass: "target-derived-untrusted",
        sourceRefs: [{ kind: "target-response", uri: "eng-1/recon/page.html" }],
      }),
      NOW,
    );
    assert.equal(trust.tier, "untrusted-target");
    assert.equal(trust.baseScore, 0.2);
  });

  it("target-derived lifts to corroborated only at 2 independent corroborations", () => {
    const trust = deriveTrust(
      trustInput({
        contentClass: "target-derived-untrusted",
        corroboration: { independentCount: 2, sourceKeys: ["target-content:eng-1", "registry:eng-2"] },
        sourceRefs: [{ kind: "target-response", uri: "eng-1/recon/page.html" }],
      }),
      NOW,
    );
    assert.equal(trust.tier, "corroborated");
    assert.equal(trust.baseScore, 0.65);
  });

  it("corroboration independence: same sourceKey or same artifact never counts", () => {
    const existing = { sourceKeys: ["target-content:eng-1"], artifactSha256s: ["aa11"] };
    assert.deepEqual(
      evaluateCorroboration(existing, { sourceClass: "target-content", sourceKey: "target-content:eng-1" }),
      { counted: false, reason: "SAME_SOURCE_KEY" },
    );
    assert.deepEqual(
      evaluateCorroboration(existing, {
        sourceClass: "target-content",
        sourceKey: "target-content:eng-2",
        artifactSha256: "aa11",
      }),
      { counted: false, reason: "SAME_ARTIFACT" },
    );
    assert.deepEqual(
      evaluateCorroboration(existing, { sourceClass: "registry", sourceKey: "registry:eng-2", artifactSha256: "bb22" }),
      { counted: true, reason: "INDEPENDENT" },
    );
  });
});

function candidate(overrides: Partial<CollapseCandidate>): CollapseCandidate {
  return {
    unitId: "mem_x",
    sourceClass: "trajectory",
    sourceKey: "trajectory:eng-1",
    claim: "unrelated words here",
    tags: [],
    baseScore: 0.45,
    tier: "single-source",
    contentClass: "normal",
    independentCount: 1,
    scopeKey: "scope-a",
    hasScope: true,
    hasTrustBlock: true,
    ...overrides,
  };
}

describe("memory collapse (brief §6)", () => {
  it("golden formula case", () => {
    const pool: CollapseCandidate[] = [
      candidate({
        unitId: "mem_c1", sourceClass: "registry", sourceKey: "registry:eng-1",
        claim: "SQL injection in login form allows auth bypass", tags: ["sqli"],
        vulnClass: "SQL Injection", baseScore: 0.85, tier: "confirmed",
      }),
      candidate({
        unitId: "mem_c2", sourceClass: "registry", sourceKey: "registry:eng-1",
        claim: "SQL injection in search parameter is not exploitable",
        vulnClass: "SQL Injection", baseScore: 0.8, tier: "killed",
      }),
      candidate({
        unitId: "mem_c3", sourceClass: "experience", sourceKey: "experience:eng-2",
        claim: "Login form rate limiting blocks brute force attempts", baseScore: 0.45,
      }),
      candidate({
        unitId: "mem_c4", sourceClass: "trajectory", sourceKey: "trajectory:eng-2",
        claim: "SQL injection probe on search parameter failed", baseScore: 0.45,
      }),
    ];
    const scored = scoreCandidates(pool, "sql injection login form");
    const byId = new Map(scored.map((s) => [s.candidate.unitId, s]));
    const close = (actual: number, expected: number) =>
      assert.ok(Math.abs(actual - expected) <= 1e-9, `${actual} != ${expected}`);
    close(byId.get("mem_c1")!.queryOverlap, 1);
    close(byId.get("mem_c1")!.blended, 0.9325);
    close(byId.get("mem_c1")!.salience0, 1.02575);
    close(byId.get("mem_c1")!.finalSalience, 1.02575);
    assert.equal(byId.get("mem_c2")!.rankWithinSource, 1);
    close(byId.get("mem_c2")!.salience0, 0.593725);
    assert.equal(byId.get("mem_c2")!.boostCount, 1);
    close(byId.get("mem_c2")!.boostAmount, 0.08905875);
    close(byId.get("mem_c2")!.finalSalience, 0.64660140634375);
    close(byId.get("mem_c3")!.finalSalience, 0.501375);
    close(byId.get("mem_c4")!.finalSalience, 0.5117009375);
    const result = collapseCandidates(pool, { query: "sql injection login form" });
    assert.deepEqual(
      result.survivors.map((s) => s.candidate.unitId),
      ["mem_c1", "mem_c2", "mem_c4", "mem_c3"],
    );
    assert.deepEqual(result.prunedUnitIds, []);
    assert.deepEqual(result.suppressedDuplicates, []);
  });

  it("corroboration counts only cross-source independent candidates", () => {
    const shared = "alpha bravo charlie delta echo";
    const samePool = scoreCandidates(
      [
        candidate({ unitId: "mem_p1", sourceClass: "trajectory", sourceKey: "trajectory:eng-1", claim: shared }),
        candidate({ unitId: "mem_p2", sourceClass: "trajectory", sourceKey: "trajectory:eng-2", claim: shared }),
      ],
      "alpha",
    );
    assert.equal(samePool[0]!.boostCount, 0);
    const sameKey = scoreCandidates(
      [
        candidate({ unitId: "mem_k1", sourceClass: "trajectory", sourceKey: "trajectory:eng-1", claim: shared }),
        candidate({ unitId: "mem_k2", sourceClass: "experience", sourceKey: "trajectory:eng-1", claim: shared }),
      ],
      "alpha",
    );
    assert.equal(sameKey[0]!.boostCount, 0);
    const independent = scoreCandidates(
      [
        candidate({ unitId: "mem_i1", sourceClass: "trajectory", sourceKey: "trajectory:eng-1", claim: shared }),
        candidate({ unitId: "mem_i2", sourceClass: "experience", sourceKey: "experience:eng-2", claim: shared }),
      ],
      "alpha",
    );
    assert.equal(independent[0]!.boostCount, 1);
    assert.equal(independent[1]!.boostCount, 1);
  });

  it("a killed candidate is never boosted by a confirmed one for the same vulnClass", () => {
    const shared = "alpha bravo charlie delta echo";
    const scored = scoreCandidates(
      [
        candidate({ unitId: "mem_d1", sourceClass: "registry", sourceKey: "registry:eng-1", claim: shared, vulnClass: "XSS", baseScore: 0.8, tier: "killed" }),
        candidate({ unitId: "mem_d2", sourceClass: "trajectory", sourceKey: "trajectory:eng-2", claim: shared, vulnClass: "XSS", baseScore: 0.85, tier: "confirmed" }),
      ],
      "alpha",
    );
    assert.equal(scored[0]!.boostCount, 0);
    assert.equal(scored[1]!.boostCount, 0);
  });

  it("untrusted candidate salience is capped at 0.25 until independently corroborated", () => {
    const capped = scoreCandidates(
      [
        candidate({
          unitId: "mem_u1", sourceClass: "target-content", sourceKey: "target-content:eng-1",
          claim: "alpha bravo charlie", baseScore: 0.2, tier: "untrusted-target",
          contentClass: "target-derived-untrusted", independentCount: 1,
        }),
      ],
      "alpha bravo charlie",
    );
    assert.equal(capped[0]!.untrusted, true);
    assert.ok(capped[0]!.finalSalience <= 0.25);
    const lifted = scoreCandidates(
      [
        candidate({
          unitId: "mem_u2", sourceClass: "target-content", sourceKey: "target-content:eng-1",
          claim: "alpha bravo charlie", baseScore: 0.65, tier: "corroborated",
          contentClass: "target-derived-untrusted", independentCount: 2,
        }),
      ],
      "alpha bravo charlie",
    );
    assert.equal(lifted[0]!.untrusted, false);
    assert.ok(lifted[0]!.finalSalience > 0.25);
  });

  it("relative prune drops below 0.35 × max", () => {
    const result = collapseCandidates(
      [
        candidate({ unitId: "mem_s1", sourceClass: "registry", sourceKey: "registry:eng-1", claim: "alpha bravo", baseScore: 1, tier: "proven" }),
        candidate({ unitId: "mem_w1", sourceClass: "operator", sourceKey: "operator:carlos", claim: "zebra xylophone quiver", baseScore: 0.45 }),
      ],
      { query: "alpha bravo" },
    );
    assert.deepEqual(result.survivors.map((s) => s.candidate.unitId), ["mem_s1"]);
    assert.deepEqual(result.prunedUnitIds, ["mem_w1"]);
  });

  it("near-duplicate suppression at 0.82 keeps the boosted survivor", () => {
    const pool = [
      candidate({ unitId: "mem_z", sourceClass: "registry", sourceKey: "registry:eng-9", claim: "alpha bravo charlie delta india juliet", baseScore: 0.85, tier: "confirmed" }),
      candidate({ unitId: "mem_x", sourceClass: "experience", sourceKey: "experience:eng-1", claim: "alpha bravo charlie delta echo foxtrot", baseScore: 0.45 }),
      candidate({ unitId: "mem_y", sourceClass: "trajectory", sourceKey: "trajectory:eng-2", claim: "alpha bravo charlie delta echo foxtrot golf", baseScore: 0.45 }),
    ];
    const result = collapseCandidates(pool, { query: "alpha bravo charlie delta" });
    assert.deepEqual(result.survivors.map((s) => s.candidate.unitId), ["mem_z", "mem_x"]);
    assert.deepEqual(result.suppressedDuplicates, ["mem_y"]);
    const x = result.survivors.find((s) => s.candidate.unitId === "mem_x")!;
    assert.equal(x.boostCount, 2);
  });

  it("budget caps at 6", () => {
    const classes = ["registry", "experience", "trajectory", "operator"] as const;
    const pool: CollapseCandidate[] = [];
    for (let i = 0; i < 8; i++) {
      pool.push(
        candidate({
          unitId: `mem_b${i}`,
          sourceClass: classes[i % 4]!,
          sourceKey: `${classes[i % 4]}:eng-${i}`,
          claim: `common topic${i} detail${i}`,
          baseScore: 0.85,
          tier: "confirmed",
        }),
      );
    }
    const result = collapseCandidates(pool, { query: "common" });
    assert.equal(result.survivors.length, 6);
    assert.equal(result.budgetDroppedUnitIds.length, 2);
  });

  it("tie-break is deterministic (base desc, unitId asc)", () => {
    const a = candidate({ unitId: "mem_z", sourceClass: "trajectory", sourceKey: "trajectory:eng-1", claim: "zebra xylophone quiver", baseScore: 0.55 });
    const b = candidate({ unitId: "mem_a", sourceClass: "registry", sourceKey: "registry:eng-2", claim: "jungle waffle harbor", baseScore: 0.5 });
    // Equal finals (0.2475) by construction; the higher base wins over unitId order.
    const forward = collapseCandidates([a, b], { query: "nomatch" });
    assert.deepEqual(forward.survivors.map((s) => s.candidate.unitId), ["mem_z", "mem_a"]);
    const reversed = collapseCandidates([b, a], { query: "nomatch" });
    assert.deepEqual(reversed.survivors.map((s) => s.candidate.unitId), ["mem_z", "mem_a"]);
    const twins = collapseCandidates(
      [
        candidate({ unitId: "mem_t2", sourceClass: "trajectory", sourceKey: "trajectory:eng-1", claim: "zebra xylophone quiver" }),
        candidate({ unitId: "mem_t1", sourceClass: "operator", sourceKey: "operator:carlos", claim: "jungle waffle harbor" }),
      ],
      { query: "nomatch" },
    );
    assert.deepEqual(twins.survivors.map((s) => s.candidate.unitId), ["mem_t1", "mem_t2"]);
  });

  it("invalid candidate throws CANDIDATE_INVALID", () => {
    assert.throws(
      () => scoreCandidates([candidate({ unitId: "mem_bad", hasTrustBlock: false })], "alpha"),
      (err: unknown) => err instanceof MemoryError && err.code === "CANDIDATE_INVALID",
    );
    assert.throws(
      () => scoreCandidates([candidate({ unitId: "mem_bad2", hasScope: false })], "alpha"),
      (err: unknown) => err instanceof MemoryError && err.code === "CANDIDATE_INVALID",
    );
  });

  it("all-zero salience returns explicit empty, no backfill", () => {
    const result = collapseCandidates(
      [candidate({ unitId: "mem_zero", claim: "zebra xylophone", baseScore: 0 })],
      { query: "nomatch" },
    );
    assert.equal(result.emptyReason, "ALL_ZERO_SALIENCE");
    assert.deepEqual(result.survivors, []);
  });
});

function unitWithScope(scope: MemoryScope): MemoryUnit {
  return {
    schemaVersion: 1,
    unitId: "mem_unit",
    version: 1,
    kind: "finding",
    claim: "example claim",
    body: "example body",
    scope,
    provenance: {
      sourceClass: "registry",
      sourceEngagementId: "eng-0",
      sourceRefs: [{ kind: "registry-entry", uri: "registry.json", registryEntryId: "e1" }],
      derivedFromUnitIds: [],
      extractor: { name: "registry-projector", version: "1", inputHash: "00" },
      createdAt: NOW,
      createdBy: "runner",
    },
    proof: { state: "confirmed", receipts: [{ kind: "registry-entry", ref: "e1" }], registryEntryId: "e1" },
    trust: { tier: "confirmed", baseScore: 0.85, derivedAt: NOW, derivation: ["RECEIPT_LINKED"] },
    corroboration: { independentCount: 1, sourceKeys: ["registry:eng-0"] },
    contentClass: "normal",
    tags: [],
    attackIds: [],
    stack: [],
    views: { l0: "example", l1: "example", sourceHash: "00", generatedAt: NOW, generator: "deterministic-v1", stale: false },
    retrieval: { retrievalCount: 0 },
    hash: "00",
  };
}

function targetScope(hosts: string[]): MemoryScope {
  return {
    kind: "engagement-target",
    scopeKey: `key-${hosts.join("-")}`,
    hosts,
    stack: [],
    originEngagementIds: ["eng-0"],
  };
}

describe("memory scope gate (brief §4.2)", () => {
  const engagementScope = deriveMemoryScope({
    engagementId: "eng-b",
    hosts: ["b.example.test"],
    verifiedAt: NOW,
    verificationProof: "operator attestation",
  });

  it("scope derivation refuses an unverified engagement", () => {
    assert.throws(
      () => deriveMemoryScope({ engagementId: "eng-x", hosts: ["x.example.test"] }),
      (err: unknown) => err instanceof MemoryError && err.code === "MEMORY_SCOPE_UNVERIFIED",
    );
  });

  it("exact host matches", () => {
    assert.equal(scopeEligible(unitWithScope(targetScope(["b.example.test"])), engagementScope), true);
  });

  it("subdomain of a listed scope domain matches", () => {
    const scope = deriveMemoryScope({
      engagementId: "eng-c",
      hosts: ["example.test"],
      verifiedAt: NOW,
      verificationProof: "operator attestation",
    });
    assert.equal(scopeEligible(unitWithScope(targetScope(["api.example.test"])), scope), true);
  });

  it("outOfScope deny beats allow", () => {
    const unit = unitWithScope(targetScope(["b.example.test"]));
    assert.equal(
      scopeEligible(unit, engagementScope, { outOfScopeHosts: ["b.example.test"] }),
      false,
    );
    const mixed = unitWithScope(targetScope(["b.example.test", "evil.example.test"]));
    assert.equal(
      scopeEligible(mixed, engagementScope, { outOfScopeHosts: ["evil.example.test"] }),
      false,
    );
  });

  it("disjoint host never matches", () => {
    assert.equal(scopeEligible(unitWithScope(targetScope(["a.example.test"])), engagementScope), false);
  });

  it("global-procedural units are always eligible; class units need the refresh context", () => {
    const global = unitWithScope({ kind: "global-procedural", scopeKey: "global", hosts: [], stack: [], originEngagementIds: [] });
    assert.equal(scopeEligible(global, engagementScope), true);
    const classUnit = unitWithScope({
      kind: "target-class",
      scopeKey: "class-nextjs",
      hosts: [],
      targetClass: "nextjs-app",
      stack: ["nextjs"],
      originEngagementIds: ["eng-0"],
    });
    assert.equal(scopeEligible(classUnit, engagementScope), false);
    assert.equal(scopeEligible(classUnit, engagementScope, { targetClass: "nextjs-app" }), true);
    assert.equal(scopeEligible(classUnit, engagementScope, { stack: ["NextJS"] }), true);
  });
});

describe("memory write gate — assertScopeBinding (brief §4.2 rules 2–3)", () => {
  const globalScope: MemoryScope = {
    kind: "global-procedural", scopeKey: "global", hosts: [], stack: [], originEngagementIds: [],
  };
  const classScope: MemoryScope = {
    kind: "target-class", scopeKey: "class-nextjs", hosts: [], targetClass: "nextjs-app",
    stack: ["nextjs"], originEngagementIds: ["eng-0"],
  };
  const tooBroad = (err: unknown) => err instanceof MemoryError && err.code === "SCOPE_TOO_BROAD";

  it("target-derived content under global or class scope is rejected loud", () => {
    const claimUnit = { ...unitWithScope(globalScope), kind: "target-derived-claim" as const };
    assert.throws(() => assertScopeBinding(claimUnit), tooBroad);
    const fromTarget = unitWithScope(classScope);
    fromTarget.provenance = { ...fromTarget.provenance, sourceClass: "target-content" };
    assert.throws(() => assertScopeBinding(fromTarget), tooBroad);
  });

  it("a class-scoped unit asserting a host-specific value is rejected loud", () => {
    const unit = unitWithScope(classScope);
    unit.claim = "the login at https://api.example.test/login leaks session tokens";
    assert.throws(() => assertScopeBinding(unit), tooBroad);
  });

  it("global scope refuses findings and non-operator/experience sources", () => {
    assert.throws(() => assertScopeBinding(unitWithScope(globalScope)), tooBroad);
  });

  it("legit bindings pass: target-scoped finding, class lesson, global operator note", () => {
    assert.doesNotThrow(() => assertScopeBinding(unitWithScope(targetScope(["b.example.test"]))));
    const lesson = unitWithScope(classScope);
    lesson.kind = "experience-lesson";
    lesson.claim = "this stack hides stack traces behind a generic error page";
    lesson.body = lesson.claim;
    assert.doesNotThrow(() => assertScopeBinding(lesson));
    const note = unitWithScope(globalScope);
    note.kind = "operator-note";
    note.provenance = { ...note.provenance, sourceClass: "operator" };
    assert.doesNotThrow(() => assertScopeBinding(note));
  });
});
