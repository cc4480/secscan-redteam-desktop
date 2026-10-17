/**
 * CONTINUOUS TESTING — watch profiles (v0.16.0).
 *
 * A watch profile is the standing configuration for continuous testing:
 * what to test (the full EngagementInput), how often (cadence), and until
 * when the authorization is fresh (scopeValidUntil — fail closed past it).
 *
 * Profiles are plain JSON files so they can live in version control next
 * to the engagement's authorization paperwork:
 *
 * ```json
 * {
 *   "version": 1,
 *   "name": "secscan-us-weekly",
 *   "engagement": {
 *     "target": "secscan.us", "mode": "red",
 *     "objective": "continuous external attack-surface validation",
 *     "roe": { "scope": ["secscan.us"] },
 *     "fullBattery": true
 *   },
 *   "cadence": { "intervalHours": 168 },
 *   "scopeValidUntil": "2026-12-31T23:59:59Z",
 *   "alertSeverities": ["critical", "high"]
 * }
 * ```
 *
 * Cadence is interval-based on purpose: for cron-style scheduling, point
 * an external scheduler (cron/systemd/CI) at
 * `redteam-runner watch --profile <file> --once`. Targeted subsets are
 * expressed through the engagement itself (--targets / excludedTechniques
 * in the ROE) — the watcher runs the engagement as declared, honestly.
 */
import type { EngagementInput } from "../types.js";
export declare const WATCH_PROFILE_VERSION = 1;
export interface WatchCadence {
    /** Hours between scheduled runs. Must be > 0. */
    intervalHours: number;
}
export type AlertSeverity = "critical" | "high" | "medium" | "low" | "info";
/**
 * v0.26.0: per-profile log-retention overrides for the watch home's
 * history.jsonl (and the cycle engagements' logs). CLI --log-max-bytes /
 * --log-max-archives and the REDTEAM_LOG_* env vars override these.
 */
export interface WatchLogRetention {
    /** Rotate once a log exceeds this many bytes. Positive integer. */
    maxBytes?: number;
    /** Archives to keep per log file. Positive integer. */
    maxArchives?: number;
}
export interface WatchProfile {
    version: 1;
    /** Short slug, used in engagement IDs and the baseline file. */
    name: string;
    /** The engagement to run every cycle — targets, scope, ROE, mode. */
    engagement: EngagementInput;
    cadence: WatchCadence;
    /**
     * ISO timestamp bounding the authorization. The watcher REFUSES to run
     * past it — fail closed. Renew by editing the profile (with the client's
     * fresh authorization), never by the runner.
     */
    scopeValidUntil: string;
    /**
     * New-finding severities that trigger immediate Slack drift alerts.
     * Default ["critical", "high"]. Ticket creation for new findings goes
     * through the engagement's normal integration step.
     */
    alertSeverities?: AlertSeverity[];
    /**
     * v0.26.0: log-retention overrides for this profile's history.jsonl and
     * its cycle engagements. Optional; CLI flags and REDTEAM_LOG_* env vars
     * override these, and everything falls back to the 50 MiB / 5-archive
     * defaults. Without a cap, a daily-cadence profile grows disk forever.
     */
    logRetention?: WatchLogRetention;
}
/** Load and strictly validate a watch profile file. Throws with a clear reason. */
export declare function loadWatchProfile(profilePath: string): WatchProfile;
/**
 * Authorization freshness — the continuous-mode safety contract. Every
 * cycle (scheduled or triggered) re-checks this; past expiry the watcher
 * refuses to run, fail closed. Renewal is a human act (fresh client
 * authorization → edit the profile), never automatic.
 */
export declare function checkScopeFresh(profile: WatchProfile, now?: Date): {
    ok: true;
} | {
    ok: false;
    reason: string;
};
/** Profile home directory: runs/, baseline.json and drift records live here. */
export declare function profileHome(profilePath: string): string;
/** Default alert severities when the profile doesn't declare them. */
export declare function alertSeverities(profile: WatchProfile): AlertSeverity[];
