/**
 * Two-phase commit orchestrator (brief §7.2). Phase 1 archives the raw
 * engagement record FIRST — synchronous, durable, and the one memory
 * operation allowed to fail the run (`MemoryArchiveError`): losing the
 * raw history silently is worse than failing the engagement. Phase 2
 * summarizes, extracts proposals through the deterministic projectors,
 * validates + scope-binds + trust-derives every one, auto-applies the
 * mechanical-projection lane, and writes the signed diff — ALWAYS,
 * including the all-zero diff. Phase 2 never throws: its failures are
 * terminal states on the commit receipt (`.failed`, status `failed`),
 * because the archive is already durable.
 */
import { type TargetDerivedClaimInput } from "./extract.js";
import type { MemoryPaths } from "./paths.js";
import { type MemoryStore } from "./store.js";
import type { MemoryEngagementReceipt, MemoryScope } from "./types.js";
import type { LiveFinding } from "../context.js";
import type { ExperienceRecord } from "../harness2/experience-record.js";
import type { RegistryEntry } from "../registry.js";
export interface MemoryCommitInput {
    store: MemoryStore;
    paths: MemoryPaths;
    engagementId: string;
    /** The live engagement directory the archive copies FROM. */
    engagementDir: string;
    target: string;
    mode: string;
    objective: string;
    outcome: string;
    haltReason?: string;
    /** The engagement's derived memory scope (receipt scopeKey + projector seed). */
    scope: MemoryScope;
    /** The scope record written into the archive manifest (the write-time binding authority, §4.2 rule 1). */
    scopeRecord: {
        hosts: string[];
        roeScope: string[];
        verificationProof?: string;
        verifiedAt?: string;
    };
    /** This engagement's registry entries (confirmed + killed). */
    registryEntries: readonly RegistryEntry[];
    liveFindings?: readonly LiveFinding[];
    /** Trajectory facts for the lesson projector; null when no trajectory was captured. */
    trajectory?: {
        failureMode?: string;
        steps?: number;
        targetClass: string;
    } | null;
    experience?: {
        records: readonly ExperienceRecord[];
        skipped: number;
        files: {
            uri: string;
            sha256: string;
        }[];
    };
    targetDerivedClaims?: readonly Omit<TargetDerivedClaimInput, "engagementId" | "nowIso">[];
    recallReceiptIds: string[];
    nowIso: string;
}
/**
 * Run the two-phase commit for a finished engagement and return the
 * receipt `run.ts` attaches to the result (§7.2). Phase 1 may throw
 * `MemoryArchiveError`; Phase 2 failures return
 * `commit: { status: "failed", error }` instead of throwing.
 *
 * @param input - The engagement's commit inputs.
 * @returns The memory engagement receipt.
 */
export declare function commitEngagementMemory(input: MemoryCommitInput): MemoryEngagementReceipt;
