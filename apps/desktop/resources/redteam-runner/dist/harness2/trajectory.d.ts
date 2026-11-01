/**
 * Harness2 trajectory + metrics capture (H2-P1).
 *
 * A finished engagement directory gains three additive artifacts, written by
 * captureEngagementTrajectory from runEngagement's finally block:
 *
 *  - trajectory.json: TrajectoryRecord { metrics, events } - the normalized
 *    trajectory plus the outcome ground truth.
 *  - metrics.json: the same RunMetrics alone, so the H2-P1b store can ingest a
 *    run without parsing the events array.
 *  - run.json: the section-5 runs + metrics rows (target class/subclass/id,
 *    harness version, layer set, failure_mode) - see ./spec5.ts.
 *
 * The section-5 `steps` rows are not rewritten here: agents.ts appends them
 * live to <engagementDir>/steps.jsonl (./steps.ts) as the model path executes,
 * and the finish path only reads them back to count steps and tool errors.
 *
 * Existing artifacts (events.jsonl, state.json, engagement.md) are only READ:
 * events.jsonl semantics are untouched and nothing here throws into a run.
 *
 * TOKEN CAPTURE: real per-response usage. agents.ts agentLoop records every
 * ChatResult.usage into the per-engagement meter (./trajectory-normalize.ts),
 * so tokensIn/tokensOut are the metered sums; 0 means no model call happened.
 */
import { type EventLog } from "../events.js";
import type { Ctx } from "../context.js";
import type { RunMetrics, RunOutcome } from "./contract.js";
import { type TokenTotals } from "./trajectory-normalize.js";
export * from "./trajectory-normalize.js";
export * from "./spec5.js";
export { writeTrajectory, type WriteTrajectoryResult, type WriteTrajectoryOptions } from "./trajectory-write.js";
export { buildHarnessStamp } from "./harness-stamp.js";
export type { HarnessStampOptions, HarnessStampWithPins } from "./harness-stamp.js";
/**
 * Bucket rule, most specific first:
 *  1. the recon fingerprint's appType ("wordpress", "scanner-saas", ...) when
 *     it is known;
 *  2. otherwise the selected target families (--targets / full battery),
 *     sorted and joined with "+" ("windows", "secscan+seclayer");
 *  3. otherwise the target host: URL scheme/userinfo/path/query/port stripped
 *     and lowercased ("shop.example.test"), "host" for a bare IPv4, or
 *     "unknown" when there is nothing to parse. This mirrors the H2-P1b
 *     ingest fallback so legacy and captured runs bucket together.
 */
export declare function deriveTargetClass(input: {
    readonly target: string;
    readonly targetIds?: readonly string[];
    readonly appType?: string;
}): string;
/**
 * Outcome rule (mechanical, from the recorded engagement status):
 *  - aborted: the run ended halted (a HaltError unwind), or its recorded
 *    blocked reason names an abort (historical records);
 *  - success: completed with confirmed evidence (findings or proven exploits);
 *  - partial: completed clean, or halted while carrying confirmed evidence;
 *  - failure: halted with no confirmed evidence, or blocked before the run.
 */
export declare function deriveOutcome(input: {
    readonly status: string;
    readonly aborted?: boolean;
    readonly blockedReason?: string;
    readonly vulnsFound: number;
    readonly exploitsSucceeded: number;
}): RunOutcome;
export interface CaptureMetricsInput {
    readonly engagementId: string;
    /** Run id; defaults to the engagement id. */
    readonly runId?: string;
    readonly target: string;
    readonly targetIds?: readonly string[];
    readonly appType?: string;
    readonly status: string;
    /** Explicit outcome override (used by tests and future callers). */
    readonly outcome?: RunOutcome;
    readonly blockedReason?: string;
    readonly aborted?: boolean;
    readonly vulnsFound: number;
    readonly falsePositives: number;
    readonly exploitsAttempted: number;
    readonly exploitsSucceeded: number;
    readonly steps: number;
    /** Real provider totals; omitted means explicit 0 (see TOKEN_CAPTURE_STATUS). */
    readonly tokensIn?: number;
    readonly tokensOut?: number;
    readonly startedAtMs?: number;
    readonly finishedAtMs?: number;
    readonly harness?: RunMetrics["harness"];
}
/** Map a finished engagement to contract RunMetrics. Pure; never throws. */
export declare function captureRunMetrics(input: CaptureMetricsInput): RunMetrics;
/** A finished run, as much as the finish path knows about it. */
export interface EngagementCaptureInput {
    readonly engagementDir: string;
    readonly engagementId: string;
    readonly target: string;
    readonly targetIds?: readonly string[];
    readonly ctx: Ctx;
    readonly events: EventLog;
    readonly environment?: NodeJS.ProcessEnv;
    /** Real provider totals once a token meter is installed; omitted => explicit 0s. */
    readonly tokens?: TokenTotals;
}
/**
 * The single additive call site: called from runEngagement's finally block for
 * every outcome (complete, halted, blocked). Guarded so a capture problem can
 * never throw into an engagement run; returns null when nothing was captured.
 * After the trajectory write it also feeds the Foundry store (see
 * foundry/capture.ts) under the same isolation guarantee.
 */
export declare function captureEngagementTrajectory(input: EngagementCaptureInput): RunMetrics | null;
