/**
 * CONTINUOUS TESTING — rolling baseline (v0.16.0).
 *
 * The baseline is the watch profile's memory: every confirmed finding ever
 * seen, keyed stably so it can be matched across runs. Finding IDs (F-1…)
 * are per-run and useless for this; the key is target + sorted ATT&CK IDs,
 * which is what actually identifies "the same vulnerability."
 *
 * The baseline is per-profile and explicit — baselines are never silently
 * merged across different scopes. One profile, one baseline.json, in the
 * profile home directory.
 */
import type { Finding } from "../types.js";
export declare const BASELINE_VERSION = 1;
export type BaselineEntryStatus = "open" | "remediated";
export interface BaselineEntry {
    /** Stable key: "<target>::<sorted ATT&CK ids>" (see findingKey). */
    key: string;
    target: string;
    severity: string;
    title: string;
    attackIds: string[];
    firstSeen: string;
    lastSeen: string;
    firstSeenEngagement: string;
    lastSeenEngagement: string;
    status: BaselineEntryStatus;
    /** Engagement + finding that last confirmed it — locates the PoC bundle for reverify. */
    engagementId: string;
    findingId: string;
    /** Set when the last drift pass couldn't mechanically resolve the entry. */
    needsReview?: boolean;
    note?: string;
}
export interface WatchBaseline {
    version: 1;
    profileName: string;
    updatedAt: string;
    entries: BaselineEntry[];
}
/**
 * Stable cross-run finding key. ATT&CK IDs are the identity of "the same
 * vulnerability" — titles are LLM-written and drift between runs. When a
 * finding carries no technique IDs, fall back to a normalized title slug
 * (documented limitation: title drift may split or merge these).
 */
export declare function findingKey(target: string, f: Pick<Finding, "attackIds" | "title">): string;
export declare function emptyBaseline(profileName: string): WatchBaseline;
/** Load the baseline, or null when this profile has never run (first cycle). */
export declare function loadBaseline(path: string): WatchBaseline | null;
export declare function saveBaseline(path: string, baseline: WatchBaseline): void;
/** Where a baseline entry's PoC bundle lives (for reverify of missing findings). */
export declare function bundlePathFor(runsDir: string, entry: Pick<BaselineEntry, "engagementId" | "findingId">): string;
