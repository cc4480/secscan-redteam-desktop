/**
 * Harness2 package section 3+4 adapter (H2-P2).
 *
 * Canonical section-9 pair selection lives in ./pair-runs.ts + ./pair-select.ts
 * (window 50, 90-day fallback, run-level S quartiles, up to 3 Q1-vs-Q4 pairs,
 * cold-start modes) and the section-8 S formula/metrics live in ./scoring.ts;
 * this module holds NO second implementation. It only:
 *
 *  1. feeds the class's section-5 rows into selectPairs()/pickWindow()/computeMetrics();
 *  2. maps one PairSelection into the section-6 package shape, including the
 *     tuner's selection-criteria statement (window size, quartile method,
 *     failure-mode coverage);
 *  3. builds section 4's window means per target class with N stated.
 *
 * Cold-start detail: section 9 selects contrasted quartile pairs only in REPAIR
 * mode (HARDEN/REPAIR-FOUNDATION cite representative runs instead). Section 6
 * requires 2-3 contrasted pairs in every package, so for those modes the adapter
 * renders best-vs-worst-S contrasts from the same scored window and labels them
 * as cold-start contrasts; the representative run ids are still stated verbatim.
 */
import { computeMetrics, fromRunRow, round } from "./scoring.js";
import { MAX_PAIRS, pickWindow, selectPairs } from "./pair-select.js";
export { MAX_PAIRS, MIN_USABLE_RUNS, WINDOW_FALLBACK_DAYS, WINDOW_FALLBACK_MIN, WINDOW_SIZE } from "./pair-select.js";
/** A package always carries at least this many contrasted pairs (spec section 6). */
export const MIN_PAIRS = 2;
/** Pairs per package unless the caller asks for fewer. */
export const DEFAULT_PAIR_COUNT = MAX_PAIRS;
/** Class scan cap for the window; the package is a contrast, not an archive. */
export const RUN_SCAN_LIMIT = 5000;
/** Aggregate scan cap: every class's own window is recomputed from this snapshot. */
export const METRICS_SCAN_LIMIT = 5000;
function clampPairs(maxPairs) {
    return Math.min(MAX_PAIRS, Math.max(MIN_PAIRS, Math.trunc(maxPairs ?? DEFAULT_PAIR_COUNT)));
}
/**
 * Cold-start modes have no section-9 quartile pair, but section 6 still wants
 * 2-3 contrasted pairs: pair best-vs-worst S in the scored window (they are by
 * construction still a high/low contrast of the same class) and say so.
 */
function coldStartContrasts(selection, maxPairs) {
    const scored = selection.scored;
    const total = scored.length;
    if (total < 2)
        return [];
    const want = Math.min(maxPairs, Math.max(MIN_PAIRS, Math.floor(total / 2)));
    const pairs = [];
    for (let index = 0; index < want; index++) {
        const high = scored[index];
        const low = scored[total - 1 - index];
        if (high === undefined || low === undefined || high.run.runId === low.run.runId)
            break;
        if (high.score <= low.score)
            break;
        pairs.push({
            high: high.run,
            low: low.run,
            note: `cold-start ${selection.mode} contrast: section 9 selects no Q1/Q4 pair in this mode, so this pairs best vs worst S in the same scored window; representative run ids: ${selection.representativeRunIds.join(", ")}`,
        });
    }
    return pairs;
}
/** Run the canonical section-9 selection and expose it as section-3 package data. */
export function selectPackageContrasts(input) {
    const rows = input.store.listRuns({ targetClass: input.targetClass, limit: RUN_SCAN_LIMIT });
    const harnessVersion = rows[0]?.harnessVersion ?? "";
    const maxPairs = clampPairs(input.maxPairs);
    const selection = selectPairs({
        rows,
        harnessVersion,
        ...(input.nowMs !== undefined ? { nowMs: input.nowMs } : {}),
        maxPairs,
    });
    const pairs = selection.mode === "REPAIR" ? selection.pairs.map((pair) => ({ high: pair.high, low: pair.low, note: pair.note ?? pair.source })) : coldStartContrasts(selection, maxPairs);
    const failureModeCoverage = selection.mode === "REPAIR" ? selection.failureModeCoverage : [...new Set(selection.window.runs.map((run) => run.failureMode))].sort();
    return {
        mode: selection.mode,
        modeReason: selection.modeReason,
        usableRuns: selection.window.size,
        windowSize: selection.windowSize,
        windowDays: selection.windowDays,
        windowMethod: `${selection.window.method} (${selection.window.size} run(s), ${selection.windowDays} day(s))`,
        quartileMethod: `quartile method: ${selection.quartileMethod}`,
        failureModeCoverage,
        representativeRunIds: selection.representativeRunIds,
        pairs,
        criteria: selection.criteria,
        latestLayerSet: rows[0]?.layerSet ?? [],
    };
}
function classMetrics(targetClass, window) {
    const metrics = computeMetrics(window.map(fromRunRow));
    return {
        targetClass,
        n: metrics.n,
        successRate: round(metrics.sr),
        meanVulns: round(metrics.vf),
        fpRate: round(metrics.fpr),
        meanSteps: round(metrics.steps),
        meanTokens: round(metrics.tok),
        crashRate: round(metrics.cr),
    };
}
/** Section 4: window means of every target class the store knows, with N. */
export function buildPackageMetrics(store, targetClass, nowMs = Date.now()) {
    const all = store.listRuns({ limit: METRICS_SCAN_LIMIT });
    const byClass = new Map();
    for (const row of all) {
        const bucket = byClass.get(row.targetClass) ?? [];
        bucket.push(row);
        byClass.set(row.targetClass, bucket);
    }
    const byTargetClass = [...byClass.entries()]
        .map(([name, rows]) => {
        const harnessVersion = rows[0]?.harnessVersion ?? "";
        const window = pickWindow({ rows, harnessVersion, nowMs });
        return { metrics: classMetrics(name, window.runs), days: window.days };
    })
        .sort((a, b) => a.metrics.targetClass.localeCompare(b.metrics.targetClass))
        .map((entry) => entry.metrics);
    const ownRows = byClass.get(targetClass) ?? [];
    const ownHarness = ownRows[0]?.harnessVersion ?? "";
    const ownWindow = ownRows.length > 0 ? pickWindow({ rows: ownRows, harnessVersion: ownHarness, nowMs }) : undefined;
    const window = byTargetClass.find((entry) => entry.targetClass === targetClass) ?? classMetrics(targetClass, []);
    return {
        windowN: window.n,
        windowDays: ownWindow?.days ?? 0,
        windowMethod: ownWindow !== undefined ? `${ownWindow.method} (${ownWindow.size} run(s))` : "no usable runs",
        window,
        byTargetClass,
    };
}
//# sourceMappingURL=package-pairs.js.map