/**
 * Phase-2 proposal processing, extracted from `commit.ts` to keep that
 * module inside the 300-line file budget: per-proposal validation,
 * corroboration handling and lane routing, plus the per-projector
 * accounting the schema-break check reads. Behaviour is unchanged.
 */
import type { MemoryCommitInput } from "./commit.js";
import type { MemoryProposal } from "./extract.js";
import type { DiffOp } from "./types.js";
export interface ProposalOutcome {
    autoApplied: DiffOp[];
    proposed: DiffOp[];
    skipped: {
        op: unknown;
        reason: string;
    }[];
    /** Per-projector accounting for the §8 row-12 schema-break check: a
     * dedupe (DUPLICATE_NO_CHANGE) is a healthy no-op, NOT a validation
     * failure — only a projector whose proposals ALL failed validation
     * (landed 0 AND noChange 0) is a schema break. */
    perProjector: Map<string, {
        proposed: number;
        skipped: number;
        landed: number;
        noChange: number;
    }>;
}
export declare function processProposals(input: MemoryCommitInput, proposals: MemoryProposal[], diffId: string): ProposalOutcome;
