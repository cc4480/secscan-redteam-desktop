/**
 * Harness2 section-9 window scan and cold-start mode decision.
 *
 * WINDOW: the most recent WINDOW_SIZE (50) USABLE runs of the class whose
 * harness_version is the current base harness version. A usable run has a
 * complete metrics row (steps_count > 0) and is not crashed (operator-
 * halted runs are not a harness signal). If that yields fewer than
 * WINDOW_FALLBACK_MIN (10) usable runs the window falls back to the last
 * WINDOW_FALLBACK_DAYS (90) days of usable runs (any harness_version); the
 * fallback is named in windowMethod so the package can state it.
 *
 * COLD START (spec section 9):
 *   - fewer than MIN_USABLE_RUNS (4) usable runs -> mode INSUFFICIENT_DATA: no
 *     package and no representative runs;
 *   - all usable runs succeeded -> HARDEN, representative runs = fastest,
 *     median and slowest by tokens;
 *   - no usable run succeeded -> REPAIR-FOUNDATION, representative runs = three
 *     failures with distinct failure modes (filled up when fewer modes exist);
 *   - otherwise -> REPAIR (pair-select.ts selects the contrasted pairs).
 *
 * The caller passes rows, so this module never opens the database and is
 * trivially testable; store-model.RunRow is structurally compatible.
 */
/** Runs considered for the window. */
export const WINDOW_SIZE = 50;
/** Fallback look-back when the harness-version window is too thin. */
export const WINDOW_FALLBACK_DAYS = 90;
/** Below this usable count the window falls back to the 90-day rule. */
export const WINDOW_FALLBACK_MIN = 10;
/** Below this usable count there is no package at all. */
export const MIN_USABLE_RUNS = 4;
/** Hard cap on contrasted pairs (spec section 9). */
export const MAX_PAIRS = 3;
const DAY_MS = 86_400_000;
/** Mode decided by the cold-start rules; INSUFFICIENT_DATA means no package. */
export const PAIR_MODES = ["REPAIR", "HARDEN", "REPAIR-FOUNDATION", "INSUFFICIENT_DATA"];
/** A run usable for the window: metrics present (steps > 0) and not crashed. */
export function isUsablePairRun(run) {
    return !run.crashed && run.outcome !== "aborted" && run.stepsCount > 0 && Number.isFinite(run.ts);
}
/** Newest first, runId ascending as the deterministic tie-break. */
export function newestFirst(a, b) {
    return b.ts - a.ts || a.runId.localeCompare(b.runId);
}
/** Pick the section-9 window (harness-version first, 90-day fallback). Pure. */
export function pickWindow(input) {
    const size = Math.max(1, Math.trunc(input.windowSize ?? WINDOW_SIZE));
    const fallbackDays = Math.max(1, Math.trunc(input.fallbackDays ?? WINDOW_FALLBACK_DAYS));
    const fallbackMin = Math.max(1, Math.trunc(input.fallbackMin ?? WINDOW_FALLBACK_MIN));
    const usable = input.rows.filter(isUsablePairRun).sort(newestFirst);
    const newestTs = usable.length > 0 ? usable[0].ts : Date.now();
    const nowMs = input.nowMs ?? newestTs;
    const versionRuns = usable.filter((run) => run.harnessVersion === input.harnessVersion).slice(0, size);
    const main = versionRuns.length >= fallbackMin
        ? { runs: versionRuns, method: "harness-version" }
        : { runs: usable.filter((run) => run.ts >= nowMs - fallbackDays * DAY_MS).slice(0, size), method: "fallback-90d" };
    const oldest = main.runs.length > 0 ? main.runs[main.runs.length - 1].ts : nowMs;
    return {
        runs: main.runs,
        size: main.runs.length,
        method: main.method,
        days: Math.ceil(Math.max(0, nowMs - oldest) / DAY_MS),
        harnessVersion: input.harnessVersion,
    };
}
/** Apply the cold-start ladder; the first rule that fires wins. */
export function decidePairMode(window, minUsable = MIN_USABLE_RUNS) {
    if (window.length < minUsable) {
        return { mode: "INSUFFICIENT_DATA", reason: `only ${window.length} usable run(s) in the window; at least ${minUsable} are needed (no package)` };
    }
    const successes = window.filter((run) => run.success).length;
    if (successes === window.length) {
        return {
            mode: "HARDEN",
            reason: `all ${window.length} usable runs succeeded: preserve behaviour and cite three successful runs (fastest, median, slowest by tokens)`,
        };
    }
    if (successes === 0) {
        return {
            mode: "REPAIR-FOUNDATION",
            reason: `none of the ${window.length} usable runs succeeded: rebuild the foundation, citing three failures with distinct failure modes`,
        };
    }
    return { mode: "REPAIR", reason: `${successes}/${window.length} usable runs succeeded: repair via the contrasted quartile pairs` };
}
function tokensAscending(a, b) {
    return a.tokensTotal - b.tokensTotal || a.ts - b.ts || a.runId.localeCompare(b.runId);
}
/** Representative run ids cited by a cold-start mode (empty for INSUFFICIENT_DATA/REPAIR). */
export function coldStartRunIds(mode, window) {
    if (mode === "HARDEN") {
        const byTokens = [...window].sort(tokensAscending);
        const fastest = byTokens[0];
        const median = byTokens[Math.floor((byTokens.length - 1) / 2)];
        const slowest = byTokens[byTokens.length - 1];
        return [fastest, median, slowest]
            .filter((run) => run !== undefined)
            .map((run) => run.runId)
            .filter((runId, index, ids) => ids.indexOf(runId) === index);
    }
    if (mode === "REPAIR-FOUNDATION") {
        const failures = window.filter((run) => !run.success).sort(newestFirst);
        const byMode = new Map();
        for (const run of failures)
            if (!byMode.has(run.failureMode))
                byMode.set(run.failureMode, run);
        const distinct = [...byMode.entries()].sort((a, b) => a[0].localeCompare(b[0])).map((entry) => entry[1]);
        const chosen = distinct.slice(0, 3);
        for (const run of failures) {
            if (chosen.length >= 3)
                break;
            if (!chosen.some((entry) => entry.runId === run.runId))
                chosen.push(run);
        }
        return chosen.map((run) => run.runId);
    }
    return [];
}
//# sourceMappingURL=pair-runs.js.map