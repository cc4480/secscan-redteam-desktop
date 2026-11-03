/**
 * Streaming engagement records.
 *
 * Three views of the same truth, all under engagements/live/<id>/:
 *  - events.jsonl — one JSON object per line, appended synchronously as each
 *    action happens. This is the LIVE feed: the console tails it.
 *  - state.json  — rewritten on every event: current phase/status, verification
 *    proof, plan, findings so far. One read gives the console everything.
 *  - engagement.md — the human paper trail (Time | Phase | Actor | Action | Result).
 */
import type { EngagementEvent, EngagementMode, EngagementPhase, EngagementStatus, Finding, OperationPlan } from "./types.js";
import type { BatteryCategory } from "./battery.js";
import { type LogRotationConfig } from "./safety/rotation.js";
/**
 * Statuses that mean the run is over — the same set ui/store.ts defines
 * for its live flag and ui/report-tools.ts for regeneration, exported
 * from here because every record consumer already imports this module
 * and writeEvent's phase guard below needs it too.
 */
export declare const TERMINAL_STATUSES: Set<string>;
export interface LiveState {
    engagementId: string;
    target: string;
    mode: EngagementMode;
    objective: string;
    status: EngagementStatus;
    phase: EngagementPhase;
    verified: boolean;
    verificationTs?: string;
    verificationProof?: string;
    /** The AUTHORIZE phase's attested scope (authorize.ts
     * stampVerifiedScope): the raw ROE entries whose hosts passed
     * authorization, persisted beside the proof so the record itself —
     * not just the in-memory Ctx — carries what was attested. Absent on
     * records written before this field existed. */
    verifiedScope?: string[];
    plan: OperationPlan | null;
    findings: Finding[];
    batteryCoverage?: Record<BatteryCategory, number>;
    /** The reporter's unified operation narrative (Megazord header for the console). */
    operationNarrative?: string;
    eventCount: number;
    startedAt: string;
    updatedAt: string;
    /** PID of the process driving this run; absent on pre-v0.33 records. */
    ownerPid?: number;
    blockedReason?: string;
    /** Q-DELIVERABLES-AUTOFIRE: absolute path per deliverable file verified
     * on disk at close, stamped by finalizeDeliverables. */
    deliverables?: Record<string, string>;
    /** True when the closing deliverable set was incomplete. */
    deliverableFailed?: boolean;
    /** SCRIBE GATE: the publisher seat's sign-off on the closing set,
     * stamped by report/scribe.ts when the set was signed. */
    artifactSignoff?: ArtifactSignoff | null;
    /** SCRIBE GATE: why the closing set shipped unsigned (defects, the
     * seat unavailable, or a dry run), stamped by report/scribe.ts; null when signed. */
    artifactUnsigned?: ArtifactUnsigned | null;
}
/** One defect in the Scribe's review of the closing deliverable set. */
export interface ScribeDefect {
    /** The artifact file the defect is in (e.g. "report.html"). */
    file: string;
    /** accuracy = contradicts the record; completeness = a promised piece
     * missing; craft = below the locked design standard. */
    class: "accuracy" | "completeness" | "craft";
    /** What fails, concretely (the line, the count, the section). */
    detail: string;
    /** What "fixed" looks like. */
    fix: string;
}
/** The publisher seat's sign-off stamp on a closing deliverable set. */
export interface ArtifactSignoff {
    by: "scribe";
    /** ISO timestamp of the signing review. */
    at: string;
    /** Review cycles the set went through (1 = signed on first review). */
    cycles: number;
}
/** The record of a closing set that shipped without the Scribe's
 * signature — the same honesty class as deliverableFailed: the set must
 * never read as approved when it was not. */
export interface ArtifactUnsigned {
    reason: "defects" | "scribe_unavailable" | "dry-run";
    /** The final cycle's defect list (empty when the seat never answered). */
    defects: ScribeDefect[];
    /** Review cycles spent before the set shipped unsigned. */
    cycles: number;
    /** ISO timestamp of the unsigned stamp. */
    at: string;
}
export declare class EventLog {
    readonly dir: string;
    readonly engagementId: string;
    private state;
    /**
     * v0.23.0: per-instance sequence counter. Previously module-global, which
     * corrupted seq numbering when two engagements ran concurrently in one
     * process (e.g. two UI-launched runs interleaving appends). Each log owns
     * its counter, seeded from its own file state on open.
     */
    private seq;
    /**
     * v0.26.0: log rotation. The first seq number living in the CURRENT
     * events.jsonl (1 for a fresh log, N+1 after a rotation archived seqs
     * 1..N). Lets the `log_rotated` audit event name the archived range.
     */
    private rotationBase;
    private readonly rotation?;
    constructor(dir: string, engagementId: string, init: {
        target: string;
        mode: EngagementMode;
        objective: string;
    }, rotation?: LogRotationConfig);
    /** Reopen an existing engagement dir (for resume / inspection). */
    static open(dir: string): EventLog;
    append(partial: Omit<EngagementEvent, "ts" | "seq" | "engagementId">): EngagementEvent;
    /**
     * v0.26.0: rotate events.jsonl (and engagement.md alongside it) when the
     * log exceeds the rotation cap. The fresh file leads with a `log_rotated`
     * audit event naming the archive and its seq range, so PoC bundles'
     * `auditSeq` references stay resolvable. Seq numbers stay continuous
     * across rotations — the audit trail is unbroken.
     */
    private rotateIfNeeded;
    private writeEvent;
    /** Merge fields into state.json (status transitions, plan, findings, proof). */
    updateState(patch: Partial<LiveState>): void;
    get snapshot(): LiveState;
    private persistState;
}
/** Read-only tail for the console: events after `afterSeq`. */
export declare function readEvents(dir: string, afterSeq?: number, limit?: number): EngagementEvent[];
/** Read-only state snapshot for the console. */
export declare function readState(dir: string): LiveState | null;
