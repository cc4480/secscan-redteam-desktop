/**
 * Memory diff / recall / engagement types — extracted from types.ts to keep
 * the core memory type module under the 300-line budget.
 */
import type { MemoryScope, MemoryUnit, TrustTier } from "./types.js";
/** §7.2 diff ops. There is deliberately no "delete" op (DELETE_NOT_SUPPORTED_V1). */
export type DiffOp = {
    opId: string;
    type: "create";
    unit: MemoryUnit;
} | {
    opId: string;
    type: "supersede";
    unitId: string;
    baseVersion: number;
    baseHash: string;
    unit: MemoryUnit;
} | {
    opId: string;
    type: "merge";
    sourceUnitIds: string[];
    unit: MemoryUnit;
} | {
    opId: string;
    type: "retire";
    unitId: string;
    baseVersion: number;
    baseHash: string;
    reason: string;
};
/** §7.2 skip reasons recorded in a diff's `skipped[]` — a skip is never silent. */
export type DiffSkipReason = "SCOPE_TOO_BROAD" | "TRUST_OVERCLAIM" | "MISSING_PROVENANCE" | "DELETE_NOT_SUPPORTED_V1" | "DUPLICATE_NO_CHANGE" | "STALE_BASE";
export interface MemoryDiff {
    /** "<engagementId>-<archiveSeq>". */
    diffId: string;
    engagementId: string;
    archiveUri: string;
    createdAt: string;
    inputHashes: {
        events: string;
        trajectory?: string;
        registryEntries: string[];
        experienceFiles: string[];
    };
    /** Mechanical projections, already active. */
    autoApplied: DiffOp[];
    /** Semantic ops awaiting §7.3 approval. */
    proposed: DiffOp[];
    skipped: {
        op: unknown;
        reason: string;
    }[];
    counts: {
        autoApplied: number;
        proposed: number;
        skipped: number;
    };
    audit: {
        legacyExperienceSkipped: number;
        extractorVersions: Record<string, string>;
    };
    status: "proposed" | "applied" | "partially-applied" | "rejected" | "failed";
    /** sha256 over the canonical diff excluding this field — approval binds to it. */
    sha256: string;
}
/** §7.3 named-operator approval/rejection record (proposals/<diffId>.approval.json). */
export interface MemoryApprovalRecord {
    diffId: string;
    diffSha256: string;
    decision: "approve" | "reject";
    approver: string;
    approvedAt: string;
    /** Default: all proposed ops. */
    opIds: string[];
    note?: string;
}
/** §7.3 apply receipt (proposals/<diffId>.apply.json). */
export interface MemoryApplyReceipt {
    diffId: string;
    applied: {
        opId: string;
        unitId: string;
        version: number;
        beforeHash?: string;
        afterHash: string;
    }[];
    skipped: {
        opId: string;
        reason: string;
    }[];
    approver: string;
    appliedAt: string;
}
/** One survivor line in a recall receipt (§7.1). */
export interface RecallSurvivorRecord {
    unitId: string;
    uri: string;
    /** "legacy" marks a §6.6 legacy experience record, which has no trust block. */
    tier: TrustTier | "legacy";
    finalSalience: number;
    untrusted: boolean;
}
/** §7.1 recall receipt (recall/<engagementId>-<phase>.json). */
export interface RecallReceipt {
    /** "<engagementId>-<phase>". */
    receiptId: string;
    engagementId: string;
    phase: "start" | "exploit";
    at: string;
    query: string;
    candidatesBySource: Record<string, number>;
    eligibleCount: number;
    decayed: string[];
    pruned: string[];
    suppressedDuplicates: string[];
    viewsRefreshed: string[];
    /** Candidates excluded because their unit view could not be refreshed (§8 row 9). */
    viewStaleExcluded: string[];
    staleDirs: string[];
    survivors: RecallSurvivorRecord[];
    untrustedDropped: number;
    /** Present when the pack is explicitly empty (§8 row 6). */
    emptyReason?: "NO_ELIGIBLE_UNITS" | "ALL_ZERO_SALIENCE";
    legacyExperienceSkipped?: number;
}
/** The pack `assembleMemoryPack` returns (brief §7.1). */
export interface MemoryPackResult {
    text: string;
    receiptId: string;
    survivors: RecallSurvivorRecord[];
    emptyReason?: "NO_ELIGIBLE_UNITS" | "ALL_ZERO_SALIENCE";
}
/** §7.2 commit receipt, attached to EngagementResult.memory. */
export interface MemoryEngagementReceipt {
    storeRoot: string;
    scopeKey: string;
    recallReceiptIds: string[];
    commit: {
        archiveId: string;
        diffId: string;
        diffSha256: string;
        status: MemoryDiff["status"];
        autoApplied: number;
        proposed: number;
        skipped: number;
    } | {
        status: "failed";
        error: string;
    };
}
/** What `Ctx.memory` carries (brief §2.3): scope, packs, receipt ids. */
export interface MemoryEngagementState {
    scope?: MemoryScope;
    startPack?: MemoryPackResult;
    exploitPack?: MemoryPackResult;
    recallReceiptIds: string[];
}
