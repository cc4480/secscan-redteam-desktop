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
import { readEvents, type EventLog } from "../events.js";
import type { Ctx } from "../context.js";
import type { EngagementStatus } from "../types.js";
import type { RunMetrics, RunOutcome, TrajectoryRecord } from "./contract.js";
import { buildHarnessStamp } from "./harness-stamp.js";
import { buildSpec5Rows } from "./spec5.js";
import { countStepErrors, readSteps } from "./steps.js";
import { toTrajectoryEvents, tokenMeterFor, type TokenTotals } from "./trajectory-normalize.js";
import { writeTrajectory } from "./trajectory-write.js";
import { captureFoundryCases } from "../foundry/capture.js";
import { storeDirForEngagement } from "../foundry/store.js";

export * from "./trajectory-normalize.js";
export * from "./spec5.js";
export { writeTrajectory, type WriteTrajectoryResult, type WriteTrajectoryOptions } from "./trajectory-write.js";
export { buildHarnessStamp } from "./harness-stamp.js";
export type { HarnessStampOptions, HarnessStampWithPins } from "./harness-stamp.js";

// ---------------------------------------------------------------------------
// targetClass rule
// ---------------------------------------------------------------------------

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
export function deriveTargetClass(input: {
  readonly target: string;
  readonly targetIds?: readonly string[];
  readonly appType?: string;
}): string {
  const appType = input.appType?.trim().toLowerCase() ?? "";
  if (appType !== "" && appType !== "unknown") return appType;
  const families = [...new Set((input.targetIds ?? []).map((id) => id.trim().toLowerCase()).filter((id) => id !== ""))];
  if (families.length > 0) return families.sort().join("+");
  const bare = input.target.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const host = (bare.split(/[/?#]/)[0] ?? "").replace(/^.*@/, "").replace(/:\d+$/, "").toLowerCase();
  if (host === "") return "unknown";
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? "host" : host;
}

// ---------------------------------------------------------------------------
// Outcome rule
// ---------------------------------------------------------------------------

/**
 * Outcome rule (mechanical, from the recorded engagement status):
 *  - aborted: the run ended halted (a HaltError unwind), or its recorded
 *    blocked reason names an abort (historical records);
 *  - success: completed with confirmed evidence (findings or proven exploits);
 *  - partial: completed clean, or halted while carrying confirmed evidence;
 *  - failure: halted with no confirmed evidence, or blocked before the run.
 */
export function deriveOutcome(input: {
  readonly status: string;
  readonly aborted?: boolean;
  readonly blockedReason?: string;
  readonly vulnsFound: number;
  readonly exploitsSucceeded: number;
}): RunOutcome {
  const status = input.status.trim().toLowerCase();
  const evidence = input.vulnsFound > 0 || input.exploitsSucceeded > 0;
  if (input.aborted === true || /abort/i.test(input.blockedReason ?? "")) return "aborted";
  if (status === "complete") return evidence ? "success" : "partial";
  if (status === "halted") return evidence ? "partial" : "failure";
  if (status === "blocked") return "failure";
  return "partial";
}

// ---------------------------------------------------------------------------
// Metrics mapping
// ---------------------------------------------------------------------------

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

function clampCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/** Map a finished engagement to contract RunMetrics. Pure; never throws. */
export function captureRunMetrics(input: CaptureMetricsInput): RunMetrics {
  const finishedAtMs = input.finishedAtMs ?? Date.now();
  const startedAtMs = input.startedAtMs ?? finishedAtMs;
  const vulnsFound = clampCount(input.vulnsFound);
  const exploitsSucceeded = clampCount(input.exploitsSucceeded);
  return {
    runId: input.runId ?? input.engagementId,
    engagementId: input.engagementId,
    targetClass: deriveTargetClass({ target: input.target, targetIds: input.targetIds, appType: input.appType }),
    outcome:
      input.outcome ??
      deriveOutcome({
        status: input.status,
        aborted: input.aborted,
        blockedReason: input.blockedReason,
        vulnsFound,
        exploitsSucceeded,
      }),
    vulnsFound,
    falsePositives: clampCount(input.falsePositives),
    exploitsSucceeded,
    exploitsAttempted: Math.max(clampCount(input.exploitsAttempted), exploitsSucceeded),
    steps: clampCount(input.steps),
    tokensIn: clampCount(input.tokensIn ?? 0),
    tokensOut: clampCount(input.tokensOut ?? 0),
    durationMs: Math.max(0, finishedAtMs - startedAtMs),
    harness: input.harness ?? buildHarnessStamp(),
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Finish-path wiring
// ---------------------------------------------------------------------------

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

const EVENT_READ_LIMIT = 100_000;

function recordedStatus(status: EngagementStatus): "complete" | "halted" | "blocked" {
  if (status === "complete" || status === "halted") return status;
  // runEngagement's blocked early return leaves state.json at "authorizing";
  // any non-terminal state at the finish path means the run was blocked.
  return "blocked";
}

/**
 * The single additive call site: called from runEngagement's finally block for
 * every outcome (complete, halted, blocked). Guarded so a capture problem can
 * never throw into an engagement run; returns null when nothing was captured.
 * After the trajectory write it also feeds the Foundry store (see
 * foundry/capture.ts) under the same isolation guarantee.
 */
export function captureEngagementTrajectory(input: EngagementCaptureInput): RunMetrics | null {
  try {
    const state = input.events.snapshot;
    const trajectoryEvents = toTrajectoryEvents(readEvents(input.events.dir, 0, EVENT_READ_LIMIT));
    // Derivation rules from what the finish path can prove:
    //  - vulnsFound: confirmed findings in state.json (live findings are mirrored
    //    there; the max keeps a halt-before-mirror from undercounting).
    //  - falsePositives: findings killed in state.json, or killed hypotheses.
    //  - exploitsAttempted: non-pending battery-ledger items for a full battery,
    //    else exploit-phase tool calls; never below the confirmed successes.
    //  - steps: dispatched tool actions (ctx.actions), the runner's planner unit.
    const confirmed = state.findings.filter((finding) => finding.status === "confirmed").length;
    const killed = Math.max(
      state.findings.filter((finding) => finding.status === "killed").length,
      input.ctx.killedLive.length,
    );
    const ledgerAttempts = [...input.ctx.itemLedger.values()].filter((verdict) => verdict.disposition !== "pending").length;
    const exploitToolCalls = trajectoryEvents.filter((event) => event.phase === "exploit" && event.isToolCall).length;
    // Real token totals from the per-engagement meter (agents.ts records every
    // router response); the explicit seam wins so tests can pin totals.
    const totals = input.tokens ?? tokenMeterFor(input.ctx).totals;
    // "aborted" used to derive from the kill switch (hostKill /
    // killSwitchAborts). That stop-signal class was removed on the
    // operator's order (2026-11-01); the metric now reports a run that
    // ended halted — the HaltError unwind (coordinator sign-off refusal
    // or a mechanical cap), which is the only in-band early end left.
    const aborted = state.status === "halted";
    const metrics = captureRunMetrics({
      engagementId: input.engagementId,
      target: input.target,
      targetIds: input.targetIds,
      appType: input.ctx.fingerprint.appType,
      status: recordedStatus(state.status),
      blockedReason: state.blockedReason,
      aborted,
      vulnsFound: Math.max(confirmed, input.ctx.liveFindings.length),
      falsePositives: killed,
      exploitsAttempted: Math.max(ledgerAttempts > 0 ? ledgerAttempts : exploitToolCalls, confirmed),
      exploitsSucceeded: confirmed,
      steps: input.ctx.actions,
      tokensIn: totals.tokensIn,
      tokensOut: totals.tokensOut,
      startedAtMs: input.ctx.startedAt,
      harness: buildHarnessStamp({ environment: input.environment }),
    });
    // Section-5 runs + metrics rows. The steps rows were journaled live by
    // agents.ts; read them back here for the step/error counts only.
    const stepRecords = readSteps(input.engagementDir);
    const spec5 = buildSpec5Rows({
      metrics,
      steps: stepRecords,
      actions: input.ctx.actions,
      maxActions: input.ctx.config?.maxActions ?? 0,
      maxDurationMs: input.ctx.config?.maxDurationMs ?? 0,
      blockedReason: state.blockedReason,
      aborted,
      toolErrors: countStepErrors(stepRecords),
      llmErrors: trajectoryEvents.filter((event) => event.action === "llm_error").length,
      target: input.target,
      targetIds: input.targetIds,
      appType: input.ctx.fingerprint.appType,
      stack: input.ctx.fingerprint.stack,
    });
    const record: TrajectoryRecord = { metrics, events: trajectoryEvents };
    const written = writeTrajectory(input.engagementDir, record, { spec5 }).written;
    // Foundry capture: every completed engagement feeds the app-data
    // Foundry store. It runs after the trajectory write, is failure-
    // isolated end to end (captureFoundryCases never throws), and records
    // its outcome as an engagement event. A capture problem can never
    // mask a halt, fail a run, or delay completion.
    try {
      const foundry = captureFoundryCases({
        engagementId: input.engagementId,
        target: input.target,
        stateFindings: state.findings,
        liveFindings: input.ctx.liveFindings,
        techFingerprints: [input.ctx.fingerprint.appType, ...input.ctx.fingerprint.stack],
        storeDir: storeDirForEngagement(input.engagementDir),
        // The automatic Gold Loop enqueue can be stood down per process
        // (REDTEAM_FOUNDRY_AUTO_LOOP=0) without touching capture itself.
        autoLoop: input.environment?.["REDTEAM_FOUNDRY_AUTO_LOOP"] !== "0",
      });
      input.events.append({
        phase: "done",
        actor: "runner",
        action: "foundry_capture",
        result: foundry.error
          ? `Foundry capture failed (failure-isolated; the engagement is unaffected): ${foundry.error}`
          : `Foundry capture: ${foundry.added} case(s) added, ${foundry.skippedDuplicates} duplicate(s) skipped, ${foundry.dropped} dropped by the sanitizer.`,
      });
    } catch {
      // The event note is best-effort; capture itself already reported
      // its outcome in its result value.
    }
    return written ? metrics : null;
  } catch {
    // Capture is observability, not part of the engagement contract: never let
    // it mask a halt or fail a run.
    return null;
  }
}
