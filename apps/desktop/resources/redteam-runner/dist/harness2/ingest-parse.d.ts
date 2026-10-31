import type { RunMetrics, TrajectoryEvent } from "./contract.js";
export declare function isObject(value: unknown): value is Record<string, unknown>;
/** Parse a JSON file; a missing file is silent, a corrupt one becomes a warning. */
export declare function readJson(path: string, warnings: string[]): unknown;
/** Parse a JSON object file, discarding non-object payloads. */
export declare function readObject(path: string, warnings: string[]): Record<string, unknown> | undefined;
/** Parse a JSON object file without recording warnings (used for fast freshness checks). */
export declare function readObjectQuiet(path: string): Record<string, unknown> | undefined;
/** Normalize a trajectory.json/metrics.json payload into the contract's RunMetrics. */
export declare function asMetrics(raw: unknown): RunMetrics | null;
export declare function asEvents(raw: unknown): TrajectoryEvent[];
/** events.jsonl: one JSON object per line; corrupt lines are skipped and counted. */
export declare function readEventsJsonl(path: string, warnings: string[]): TrajectoryEvent[];
/** engagement.md fallback: the runner's `| ts | phase | actor | action | result |` table. */
export declare function readEngagementMd(path: string, warnings: string[]): TrajectoryEvent[];
/** Metrics for a legacy run: honest zeroes where only the event log survives. */
export declare function deriveMetrics(engagementId: string, state: Record<string, unknown> | undefined, events: readonly TrajectoryEvent[]): RunMetrics;
