import type { ExperienceRecord } from '../harness2/experience-record.js';
import { type MemoryProposal } from './extract.js';
export interface TrajectoryProjectionInput {
    engagementId: string;
    targetClass: string;
    outcome: string;
    /** The run's failure mode; absent or "none" for a clean run. */
    failureMode?: string;
    haltReason?: string;
    steps?: number;
    confirmedCount: number;
    killedCount: number;
    nowIso: string;
}
/**
 * Project the run's outcome to at most one `trajectory-lesson` unit,
 * class-scoped by the caller's `deriveTargetClass` result. A pure
 * failure-mode record (failure mode + mechanical counts) is a direct
 * projection and rides the auto lane; an outcome lesson is an
 * interpretation and waits for an operator (§7.2). Claim and body carry
 * no host-specific values — the class scope binding (§4.2) forbids them;
 * the target class itself lives in the scope fields only.
 *
 * @param input - The run's outcome facts.
 * @returns Zero or one proposal.
 */
export declare function projectTrajectory(input: TrajectoryProjectionInput): MemoryProposal[];
export interface ExperienceProjectionInput {
    /** Parsed EXPERIENCE.md records (the parser's skipped count rides the commit input, not the drafts). */
    records: readonly ExperienceRecord[];
    /** URI of the EXPERIENCE.md file the records came from. */
    fileUri: string;
    nowIso: string;
}
/**
 * Project adopted (status `active`) EXPERIENCE.md records that have no
 * unit yet to `experience-lesson` units, class-scoped by the record's
 * target class. Proposed lane: a lesson is an interpretation until a
 * named operator approves it (§7.2). Reverted/superseded records are not
 * projected in v1; the commit records each as a DELETE_NOT_SUPPORTED_V1
 * skip in the diff (v1 has no delete op — see commit.ts).
 *
 * @param input - The parsed records and their file URI.
 * @returns One proposed-lane proposal per active record.
 */
export declare function projectExperience(input: ExperienceProjectionInput): MemoryProposal[];
