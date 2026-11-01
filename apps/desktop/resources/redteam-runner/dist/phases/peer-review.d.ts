/**
 * Q-FLEET-XCHECK — the fleet peer cross-check (Carlos's order,
 * 2026-10-31; spec: fleet-peer-cross-check-2026-10-31.md).
 *
 * Before the report, every live finding is challenged by a DIFFERENT
 * fleet seat than the one that produced it: does the evidence actually
 * prove it, was the scope respected, is the severity honest? Producer
 * and checker are never the same seat — the checker is picked from a
 * fixed preference list with the producer removed, so a same-seat
 * challenge is impossible by construction, not by prompt discipline.
 *
 * The checker answers a structured verdict (upheld / downgraded /
 * needs-evidence / killed) through the same completion seam the agent
 * loop uses (deps seam in tests, chartered seam in production). The
 * RUNNER applies the verdict mechanically — the model proposes, the
 * runner disposes:
 *  - upheld        → the finding flows to the reporter, stamped.
 *  - downgraded    → severity lowered on the ladder (the checker's
 *                    proposed rung when it is strictly lower, else one
 *                    notch; at the floor the finding flows unchanged).
 *  - needs-evidence → the finding leaves the confirmed flow and is
 *                    reported as deferred, stamped.
 *  - killed        → the finding leaves the confirmed flow, joins the
 *                    killed record (shared state + registry), stamped.
 * A PROVEN cell verdict outranks a peer kill (proven wins — the cell's
 * dual signatures + negative control are the stronger evidence the
 * spec lets a kill fall to); the override is recorded on the stamp's
 * disposition and in the verdict event, never silently.
 *
 * Every challenge and verdict is an engagement event (peer_challenge /
 * peer_verdict / peer_review_failed / peer_review_complete) — the
 * exchange is model-visible to the reporter through the stamps, and
 * every stamp is reconstructable from the log. A checker call that
 * fails or answers unparseably never halts the engagement and never
 * fabricates a verdict (Q-HALT discipline): the finding flows
 * unstamped and the failure is an event carrying the cause. A
 * HaltError (deliberate stop) rethrows untouched.
 */
import { type AgentRole } from "@secscan/redteam-llm-router";
import { type Ctx } from "../context.js";
import { type ActorRole, type PeerReviewStamp } from "../types.js";
/** Checker preference: the Architect owns review; then the coordinator
 * (the sign-off seat), reporter, recon, exploiter. The producer is
 * removed from the list before picking — see selectChecker. */
export declare const CHECKER_PREFERENCE: readonly AgentRole[];
/**
 * The checker for a finding: the first preferred seat that is NOT the
 * producer. Pure and total — for every producer (including 'runner'
 * and an absent stamp) some other seat is returned, so the pass can
 * never seat a finding's producer as its own checker.
 */
export declare function selectChecker(producer: ActorRole | undefined): AgentRole;
export declare const SEVERITY_LADDER: readonly ["info", "low", "medium", "high", "critical"];
export type PeerVerdict = PeerReviewStamp["verdict"];
export interface ParsedPeerVerdict {
    verdict: PeerVerdict;
    /** Proposed lower severity, only meaningful for 'downgraded'. */
    severity?: string;
    rationale: string;
}
/** Parse the checker's answer. Anything off-shape is null — the caller
 * records a failed challenge, never a guessed verdict. */
export declare function parsePeerVerdict(text: string): ParsedPeerVerdict | null;
/**
 * The reviewer pass: challenge every live finding with a different
 * seat and apply the outcomes. Runs after exploitation, before the
 * report (wired in phases/run.ts ahead of the exploit→report
 * sign-off, so sign-off counts are post-challenge). No-ops on dry
 * runs — there are no agent findings to challenge.
 */
export declare function peerReviewPhase(ctx: Ctx): Promise<void>;
