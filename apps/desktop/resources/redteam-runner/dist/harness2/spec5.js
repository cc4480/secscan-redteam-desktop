/** File name inside the engagement directory. */
export const SPEC5_FILE_NAME = "run.json";
/** False-positive blow-up thresholds: 2 wrong claims and half of all claims. */
export const FP_BLOWUP_MIN_FALSE_POSITIVES = 2;
export const FP_BLOWUP_MIN_RATIO = 0.5;
/** Halt reasons that mean the process/run failed internally, not mechanically. */
const CRASH_REASON = /unexpected error|crash|out of memory|heap out of memory|ENOSPC|EACCES|EPIPE/i;
function normalizeIds(values) {
    return [...new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter((value) => value !== ""))].sort();
}
/** Second-level target bucket; see the header rules. */
export function deriveTargetSubclass(input) {
    const families = normalizeIds(input.targetIds);
    const appType = (input.appType ?? "").trim().toLowerCase();
    if (appType !== "" && appType !== "unknown" && appType === input.targetClass.trim().toLowerCase()) {
        return families.length > 0 ? families.join("+") : "unknown";
    }
    const stack = normalizeIds(input.stack);
    return stack.length > 0 ? stack.join("+") : "unknown";
}
/** The specific target instance: the engagement's raw target string. */
export function deriveTargetId(target) {
    const trimmed = target.trim();
    return trimmed === "" ? "unknown" : trimmed;
}
/** Claims = confirmed claims + claims later killed as false positives. */
export function claimsTotalOf(metrics) {
    return Math.max(0, metrics.vulnsFound) + Math.max(0, metrics.falsePositives);
}
/** True when the run died of an unexpected internal error (not an abort). */
export function isCrashed(facts) {
    if (facts.aborted)
        return false;
    return CRASH_REASON.test(facts.blockedReason ?? "");
}
function timedOut(facts, reason) {
    if (/duration cap/i.test(reason))
        return true;
    return facts.maxDurationMs > 0 && facts.metrics.durationMs >= facts.maxDurationMs;
}
function stepsExhausted(facts, reason) {
    if (/action cap/i.test(reason))
        return true;
    return facts.maxActions > 0 && facts.actions >= facts.maxActions;
}
function fpBlowup(metrics) {
    const falsePositives = Math.max(0, metrics.falsePositives);
    const claims = claimsTotalOf(metrics);
    if (falsePositives < FP_BLOWUP_MIN_FALSE_POSITIVES || claims === 0)
        return false;
    return falsePositives / claims >= FP_BLOWUP_MIN_RATIO;
}
/** The documented failure-mode ladder; see the header for the precedence. */
export function deriveFailureMode(facts) {
    if (facts.aborted)
        return "none";
    const reason = (facts.blockedReason ?? "").trim();
    if (timedOut(facts, reason))
        return "timeout";
    if (stepsExhausted(facts, reason))
        return "step-exhaustion";
    if (isCrashed(facts) || facts.toolErrors > 0 || facts.llmErrors > 0)
        return "tool-error";
    if (fpBlowup(facts.metrics))
        return "fp-blowup";
    if (Math.max(0, facts.metrics.vulnsFound) === 0)
        return "missed-vuln";
    return "none";
}
/** Build the section-5 `runs` row. Pure; never throws. */
export function buildSpec5RunsRow(facts) {
    const metrics = facts.metrics;
    const finishedAtMs = Date.parse(metrics.finishedAt);
    return {
        run_id: metrics.runId,
        ts: Number.isFinite(finishedAtMs) ? finishedAtMs : Date.now(),
        target_class: metrics.targetClass,
        target_subclass: deriveTargetSubclass({
            targetClass: metrics.targetClass,
            targetIds: facts.targetIds,
            appType: facts.appType,
            stack: facts.stack,
        }),
        target_id: deriveTargetId(facts.target),
        harness_version: metrics.harness.runnerVersion,
        layer_set: JSON.stringify([...metrics.harness.layerIds]),
        cycle_ref: null,
    };
}
/** Build the section-5 `metrics` row. Pure; never throws. */
export function buildSpec5MetricsRow(facts) {
    const metrics = facts.metrics;
    return {
        run_id: metrics.runId,
        success: metrics.outcome === "success" ? 1 : 0,
        vulns_found: Math.max(0, Math.trunc(metrics.vulnsFound)),
        claims_total: claimsTotalOf(metrics),
        false_positives: Math.max(0, Math.trunc(metrics.falsePositives)),
        steps_count: facts.steps.length > 0 ? facts.steps.length : Math.max(0, Math.trunc(facts.actions)),
        tokens_total: Math.max(0, metrics.tokensIn) + Math.max(0, metrics.tokensOut),
        crashed: isCrashed(facts) ? 1 : 0,
        failure_mode: deriveFailureMode(facts),
    };
}
/** Build both section-5 rows for a finished engagement. */
export function buildSpec5Rows(facts) {
    return { run: buildSpec5RunsRow(facts), metrics: buildSpec5MetricsRow(facts) };
}
//# sourceMappingURL=spec5.js.map