/**
 * Memory-unit schema (brief §4) and the receipt/diff types of §5.3/§7.
 * Types only, no logic. Field definitions are the brief's, verbatim in
 * meaning: a unit never exists without a scope, a trust block is always
 * derived by `trust.ts` (never taken from a proposal's word), and there
 * is no delete operation in v1.
 */
export type MemoryUnitKind = "finding" | "killed-hypothesis" | "trajectory-lesson" | "target-fact" | "experience-lesson" | "operator-note" | "target-derived-claim";
export type MemorySourceClass = "proof-bundle" | "registry" | "trajectory" | "experience" | "operator" | "target-content" | "model-inference";
export interface SourceRef {
    kind: "engagement-event" | "trajectory" | "metrics" | "registry-entry" | "experience-record" | "proof-bundle" | "report" | "operator-note" | "target-response";
    /** memory://… URI or engagement-relative path (e.g. "<engId>/events.jsonl"). */
    uri: string;
    /** Hash of the referenced artifact when it is a file. */
    sha256?: string;
    eventSeq?: number;
    registryEntryId?: string;
}
export interface ReceiptRef {
    kind: "evidence" | "proof-bundle" | "negative-control" | "registry-entry" | "approval";
    /** evidenceRef / bundle path / receipt id — resolvable from the engagement dir or registry. */
    ref: string;
    sha256?: string;
    label?: string;
}
/** §4.2 — the binding every unit carries. REQUIRED; no default exists. */
export interface MemoryScope {
    kind: "engagement-target" | "target-class" | "global-procedural";
    /** §3.2 hash identity — slugs are for humans, the hash is the identity. */
    scopeKey: string;
    /** Normalized exact hosts; REQUIRED non-empty for engagement-target scope. */
    hosts: string[];
    /** REQUIRED for target-class scope. */
    targetClass?: string;
    /** Applicability hints for class matching (may be empty). */
    stack: string[];
    appType?: string;
    /** Every engagement that contributed to this unit. */
    originEngagementIds: string[];
}
export type TrustTier = "proven" | "confirmed" | "killed" | "corroborated" | "single-source" | "untrusted-target";
/** §4.3 — derived by `trust.ts` from proof, never voted and never asserted. */
export interface TrustBlock {
    tier: TrustTier;
    /** 0..1 — the collapse base (§6). */
    baseScore: number;
    derivedAt: string;
    /** Reason codes, e.g. ["CELL_PROVEN", "NEGATIVE_CONTROL_OK", "RECEIPT_LINKED"]. */
    derivation: string[];
}
export type ProofState = "proven" | "confirmed" | "killed" | "deferred" | "unproven";
export interface MemoryProof {
    state: ProofState;
    /** REQUIRED non-empty for proven/confirmed (see the §4.3 derivation rules). */
    receipts: ReceiptRef[];
    registryEntryId?: string;
    findingId?: string;
    /** Copied from LiveFinding adjudication, never asserted by an extractor. */
    cellState?: "proven" | "detected";
    /** Required when cellState === "proven". */
    negativeControlReceiptRef?: string;
}
export interface MemoryCorroboration {
    /** Count of INDEPENDENT corroborations (§4.3), maintained by trust.ts. */
    independentCount: number;
    /** One key per corroborating source: "<sourceClass>:<engagementId|operator>". */
    sourceKeys: string[];
    lastCorroboratedAt?: string;
}
export interface MemoryViews {
    /** L0 abstract, ≤ 256 chars. */
    l0: string;
    /** L1 overview, ≤ 4000 chars. */
    l1: string;
    /** sha256 of the canonical record this view was generated from. */
    sourceHash: string;
    generatedAt: string;
    /** "deterministic-v1" in v1. */
    generator: string;
    stale: boolean;
}
export interface MemoryUnit {
    schemaVersion: 1;
    /** "mem_" + sha256(scopeKey ‖ kind ‖ normalizedClaimHash ‖ primarySourceRef).slice(0, 24). */
    unitId: string;
    /** Starts 1; a content change is a NEW version line, never an edit. */
    version: number;
    kind: MemoryUnitKind;
    /** One normalized assertion, ≤ 2000 chars — the thing recall ranks. */
    claim: string;
    /** L2 detail (Markdown), ≤ 20000 chars — the original the views summarize. */
    body: string;
    scope: MemoryScope;
    provenance: {
        sourceClass: MemorySourceClass;
        sourceEngagementId?: string;
        /** At least one; empty provenance is a validation error. */
        sourceRefs: SourceRef[];
        derivedFromUnitIds: string[];
        /** Which projector/code produced this version. */
        extractor: {
            name: string;
            version: string;
            inputHash: string;
        };
        createdAt: string;
        /** "runner" or a named operator. */
        createdBy: "runner" | string;
    };
    proof: MemoryProof;
    trust: TrustBlock;
    corroboration: MemoryCorroboration;
    /** §4.3 poisoning guard class. */
    contentClass: "normal" | "target-derived-untrusted";
    tags: string[];
    /** ATT&CK ids, uppercased. */
    attackIds: string[];
    vulnClass?: string;
    /** Harness2 target class when the unit is class-scoped. */
    targetClass?: string;
    /** Normalized lowercase stack hints (may be empty for target units). */
    stack: string[];
    views: MemoryViews;
    /** TELEMETRY ONLY (§4.3) — never moves trust. */
    retrieval: {
        retrievalCount: number;
        lastRetrievedAt?: string;
    };
    /** sha256 over the canonical record excluding `hash` itself. */
    hash: string;
}
/** The pure input `deriveTrust` (trust.ts) computes over. */
export interface TrustDerivationInput {
    proof: MemoryProof;
    corroboration: MemoryCorroboration;
    contentClass: MemoryUnit["contentClass"];
    /** provenance.sourceRefs — the killed row needs the killing-observation link. */
    sourceRefs: SourceRef[];
}
/** §4.4 status overlay — one line per transition in commits.jsonl. */
export type MemoryUnitStatus = "active" | "proposed" | "superseded" | "retired";
export interface MemoryStatusLine {
    unitId: string;
    version: number;
    status: MemoryUnitStatus;
    at: string;
    by: string;
    reason: string;
    diffId?: string;
    successorUnitId?: string;
}
/** §5.3 directory-view freshness bookkeeping (views.json). */
export interface DirectoryFreshness {
    /** "scope/<scopeKey>" | "class/<targetClass>" | "global". */
    dir: string;
    totalUnits: number;
    coveredUnits: number;
    pendingUnitChanges: number;
    /** sha256 over the sorted current-version hashes the view covers. */
    sourceHashAggregate: string;
    generatedAt: string;
    /** pendingUnitChanges > 0. */
    stale: boolean;
}
export * from "./types-diff.js";
