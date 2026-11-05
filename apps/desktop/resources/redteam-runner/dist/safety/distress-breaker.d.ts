/**
 * Engagement distress circuit breaker (fleet charter, spec §6) — the
 * layer above the per-target auto-halt (autohalt.ts).
 *
 * The auto-halt stops traffic to a distressed target and dispatch
 * refuses it for the rest of the engagement. What the charter adds,
 * and this module owns:
 *
 *  - ESCALATION IS A RECORD, not just an event line. Every target halt
 *    is registered here with its reason, forming the engagement's
 *    distress record the Coordinator (or the human operator) decides
 *    from — preserved state, not a scrolled-past log entry.
 *  - RESUME IS A DECISION, never a default. A halted target stays
 *    halted until a resume decision is recorded naming WHO decided
 *    (coordinator or human) and the rationale. There is no timer, no
 *    retry counter, and no code path that clears a halt on its own:
 *    `resumeTarget` refuses without a recorded decision, and the only
 *    way to record one is this module's explicit call.
 *  - ENGAGEMENT-WIDE VIEW. When halts accumulate (default: 3 distinct
 *    targets), the breaker reports the engagement itself as distressed
 *    — the signal for the Coordinator to halt the engagement's attack
 *    work entirely rather than pivot forever across a buckling estate.
 *
 * The registry is keyed by engagement id and lives for the process;
 * the runner is one engagement per process in practice.
 */
export interface DistressHaltRecord {
    host: string;
    reason: string;
    /** 1-based order of this halt within the engagement. */
    seq: number;
}
export interface ResumeDecision {
    by: "coordinator" | "human";
    rationale: string;
}
/** Distinct halted targets at which an engagement counts as distressed overall. */
export declare const ENGAGEMENT_DISTRESS_TARGET_THRESHOLD = 3;
/**
 * Register one target halt (called by dispatch when the auto-halt
 * fires). Idempotent per host: a host already on record keeps its
 * first halt record.
 */
export declare function registerDistressHalt(engagementId: string, host: string, reason: string): DistressHaltRecord;
/** The engagement's distress record, in halt order. */
export declare function distressHalts(engagementId: string): DistressHaltRecord[];
/** True when the engagement's halts meet the engagement-wide distress threshold. */
export declare function engagementDistressed(engagementId: string, threshold?: number): boolean;
/**
 * Record the resume decision for one halted target. This is the ONLY
 * input that can clear a halt, and it must name its decider and its
 * rationale — an empty rationale is not a decision.
 */
export declare function recordResumeDecision(engagementId: string, host: string, decision: ResumeDecision): void;
/** The recorded resume decision for a target, if one exists. */
export declare function resumeDecisionFor(engagementId: string, host: string): ResumeDecision | undefined;
/**
 * Resume one halted target: refuses unless a resume decision is on
 * record for it. On success the auto-halt tracker is reset for the host
 * and the decision is consumed (a second halt needs a second decision).
 */
export declare function resumeTarget(engagementId: string, host: string, autoHalt: {
    reset: (host: string) => void;
}): ResumeDecision;
/**
 * Register a halt and render its escalation text (dispatch calls this
 * when the auto-halt fires): the halt's place in the record, the
 * resume terms, and the engagement-wide warning when the threshold
 * is met.
 */
export declare function distressEscalationResult(engagementId: string, host: string, reason: string): string;
/** Test/maintenance helper: forget one engagement's distress record. */
export declare function clearDistressRecord(engagementId: string): void;
