/**
 * CONTINUOUS TESTING — drift detection (v0.16.0).
 *
 * Two phases, kept deliberately separate:
 *
 *   Phase 1 (pure, no traffic) — classifyDrift(): match this run's
 *   confirmed findings against the baseline by stable key →
 *   new / unchanged / missing.
 *
 *   Phase 2 (mechanical reverify, traffic) — resolveMissingDrift(): for
 *   each missing entry, re-execute its PoC bundle via the injected
 *   reverify function:
 *     reproduced     → "reopened"   (still there; this run just missed it)
 *     not-reproduced → "remediated" (verified fix — the ONLY way an entry
 *                                    becomes remediated; never assumed)
 *     target-changed → "needs-review"
 *     no bundle / reverify error → "needs-review"
 *
 * A finding that merely didn't reproduce due to a moved target is
 * "needs-review," never "fixed." Honesty is structural: the remediated
 * verdict is unreachable without a confirming reverify.
 */
import type { Finding } from "../types.js";
import type { ReverifyVerdict } from "../proof/index.js";
import { type BaselineEntry, type WatchBaseline } from "./baseline.js";
export type DriftDisposition = "reopened" | "remediated" | "needs-review";
export interface DriftMissing {
    entry: BaselineEntry;
    disposition: DriftDisposition;
    reverifyVerdict?: ReverifyVerdict;
    note: string;
}
export interface DriftClassification {
    /** Confirmed findings with no baseline match. */
    newFindings: Finding[];
    /** Confirmed findings matched to an open baseline entry. */
    unchanged: Array<{
        finding: Finding;
        entry: BaselineEntry;
    }>;
    /** Baseline entries (open or needs-review) absent from this run. */
    missing: BaselineEntry[];
}
/**
 * Phase 1 — pure key matching, no traffic. Only confirmed findings count;
 * killed/deferred findings are not findings. Duplicate keys within one run
 * (same technique twice on one target) get a "#2" suffix so nothing is
 * silently merged.
 */
export declare function classifyDrift(baseline: WatchBaseline, current: Finding[], target: string): DriftClassification;
/** Injected reverify — tests fake it; the watcher wires the real replayer. */
export type ReverifyFn = (bundlePath: string) => Promise<{
    verdict: ReverifyVerdict;
    note: string;
}>;
/**
 * Phase 2 — resolve every missing entry. Never throws: a failed reverify
 * is "needs-review," never a silent drop.
 */
export declare function resolveMissingDrift(missing: BaselineEntry[], runsDir: string, reverify: ReverifyFn): Promise<DriftMissing[]>;
export interface DriftReport {
    version: 1;
    profileName: string;
    engagementId: string;
    /** CI/CD change reference for trigger runs, e.g. "deploy abc123". */
    changeRef?: string;
    generatedAt: string;
    newFindings: Finding[];
    unchangedCount: number;
    reopened: DriftMissing[];
    remediated: DriftMissing[];
    needsReview: DriftMissing[];
}
export declare function buildDriftReport(args: {
    profileName: string;
    engagementId: string;
    changeRef?: string;
    classification: DriftClassification;
    resolved: DriftMissing[];
}): DriftReport;
/**
 * Fold the drift report back into the baseline. Entries are never deleted —
 * remediated ones stay as history (firstSeen → lastSeen spans the finding's
 * lifetime). New findings become open entries pointing at this run's PoC
 * bundles for future reverify.
 */
export declare function applyDriftToBaseline(baseline: WatchBaseline, report: DriftReport, target: string, engagementId: string, nowIso: string): WatchBaseline;
/** Keys the caller wants refreshed (unchanged this run + reopened). */
export declare function touchBaselineEntries(baseline: WatchBaseline, keys: string[], engagementId: string, nowIso: string): WatchBaseline;
/** Mark remediated entries (reverify-confirmed only — enforced by the caller). */
export declare function remediateBaselineEntries(baseline: WatchBaseline, keys: string[], nowIso: string): WatchBaseline;
/** Flag entries that need human review. */
export declare function flagBaselineNeedsReview(baseline: WatchBaseline, keys: string[], note: string): WatchBaseline;
export declare function renderDriftMarkdown(report: DriftReport): string;
