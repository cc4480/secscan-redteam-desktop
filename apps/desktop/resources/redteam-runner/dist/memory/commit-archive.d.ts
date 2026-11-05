/**
 * Phase 1 of the two-phase commit, extracted from `commit.ts` to keep
 * that module inside the 300-line file budget: the commit input shape,
 * the raw engagement archive (the one memory step allowed to fail the
 * run) and the fixed-template session summary. Behaviour is unchanged.
 */
import type { LiveFinding } from "../context.js";
import type { ExperienceRecord } from "../harness2/experience-record.js";
import type { RegistryEntry } from "../registry.js";
import type { TargetDerivedClaimInput } from "./extract.js";
import type { MemoryPaths } from "./paths.js";
import type { MemoryStore } from "./store.js";
import type { MemoryScope } from "./types.js";
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
interface ArchiveResult {
    seq: number;
    dir: string;
    fileHashes: Map<string, string>;
}
/** Phase 1 — archive. Throws MemoryArchiveError; the caller lets it replace the run's return (§7.2). */
export declare function archiveEngagement(input: MemoryCommitInput): ArchiveResult;
/** The fixed-template session summary (§7.2 Phase 2 step 1) — no free-form invention. */
export declare function buildSummary(input: MemoryCommitInput, archiveDir: string): string;
export {};
