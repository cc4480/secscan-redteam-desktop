/**
 * Pure event projections (v0.33.0).
 *
 * The engagement record is a flat JSONL stream; the console, the report and the
 * compliance pack all need derived views of it. These functions are the single
 * place those views are computed — no filesystem, no state, each takes the
 * already-read event array and returns a plain result. Keeping them pure means
 * they are unit-testable and reusable by the report, the proof layer and any
 * future query tool (the analogue of AlterEgo's `projections.py`).
 */
import type { EngagementEvent, EngagementPhase } from "../types.js";
/** Per-action activity summary, oldest first preserved. */
export interface ToolStats {
    action: string;
    count: number;
    attackIds: string[];
    firstSeq: number;
    lastSeq: number;
    firstTs?: string;
    lastTs?: string;
}
/** Per-phase actor breakdown. */
export interface PhaseActorStats {
    phase: EngagementPhase;
    actors: Record<string, number>;
    total: number;
}
/** A single event with its resolved cause chain (oldest → newest). */
export interface CausalChain {
    seq: number;
    chain: EngagementEvent[];
}
/** Count events per action, preserving first-seen order. */
export declare function projectToolStats(events: EngagementEvent[]): ToolStats[];
/** Per-phase counts of which actor did what. */
export declare function projectActorTimeline(events: EngagementEvent[]): PhaseActorStats[];
/** The operator-decision events, in stream order — the approval timeline. */
export declare function projectApprovals(events: EngagementEvent[]): EngagementEvent[];
/** Events that produced a finding. */
export declare function projectFindings(events: EngagementEvent[]): EngagementEvent[];
/**
 * Resolve the causal chain ending at `seq`, walking `causedBy` links backward.
 * Returns oldest-first, including the event at `seq` itself. An event with no
 * `causedBy` yields a one-element chain. An unresolvable `causedBy` link stops
 * the walk rather than looping.
 */
export declare function projectCausalChain(events: EngagementEvent[], seq: number): CausalChain;
/** Every event id that is referenced as a cause but never appears — an integrity check. */
export declare function projectDanglingCauses(events: EngagementEvent[]): number[];
