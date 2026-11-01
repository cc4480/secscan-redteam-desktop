import type { Ctx } from "./context.js";
import type { EngagementPhase } from "./types.js";
/** Default rounds between soft-cap checkpoints when nothing configures one. */
export declare const DEFAULT_SOFT_ROUND_CAP = 8;
/** Per-call round-cap override for agentLoop (see ResolvedRunnerConfig). */
export interface RoundCaps {
    softCapRounds?: number;
    hardCapRounds?: number;
}
/** A file a turn is expected to leave behind. */
export interface DeliverableSpec {
    path: string;
    /** How to name the file in the nudge (default: the path's basename). */
    label?: string;
    /** Re-prompts before giving up and reporting the miss (default 2). */
    maxNudges?: number;
}
export type TurnStop = "finished" | "soft" | "hard";
export declare class TurnIntegrity {
    private readonly ctx;
    private readonly phase;
    /** min(caller's maxTurns, hard cap) — the loop's real round budget. */
    readonly effectiveMaxTurns: number;
    /** How the loop ended; "hard" until the model or the soft cap says otherwise. */
    stopReason: TurnStop;
    private readonly softCap;
    private readonly hardCap;
    /** Whether the previous round advanced the work. */
    private progressed;
    private continuations;
    private nudges;
    private readonly deliverable?;
    private readonly label;
    private readonly maxNudges;
    constructor(ctx: Ctx, phase: EngagementPhase, maxTurns: number, caps?: RoundCaps, deliverable?: DeliverableSpec);
    /**
     * Soft-cap checkpoint, called at the top of every round with the number
     * of rounds completed so far. Reads the PREVIOUS round's progress verdict,
     * then resets it for the round about to start — recomputing per round is
     * what keeps a stale success from carrying a stuck loop past the cap.
     * Returns true when the turn must stop now (soft cap, stuck).
     */
    checkpoint(roundsCompleted: number): boolean;
    /** Record one dispatched tool result's verdict for the current round. */
    noteToolResult(progressed: boolean): void;
    /** The model finished on its own (no cap involved). */
    markFinished(): void;
    /**
     * The model stopped calling tools. When a deliverable is declared, still
     * missing, and nudges remain, returns the nudge prompt (and records the
     * `deliverable_nudge` event); otherwise returns null and the turn may end.
     */
    deliverableNudge(): string | null;
    /**
     * Call once after the loop exits without throwing. A "hard" stop means
     * the round budget ran out with the model still working — announce it
     * like the soft cap does: a turn never ends at a limit without saying
     * which one. Then state the deliverable's fate, when one was declared.
     */
    finalize(): void;
}
