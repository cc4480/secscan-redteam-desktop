/**
 * One watch cycle: freshness gate -> engagement -> drift -> baseline ->
 * alerts. Never throws for operational failures — they become a result
 * with status refused/error and a reason.
 */
import type { WatchCycleOptions, WatchCycleResult } from "./types.js";
export declare function runWatchCycle(opts: WatchCycleOptions): Promise<WatchCycleResult>;
/**
 * Loop watch cycles on the profile's cadence until aborted. The profile is
 * re-read every cycle so authorization renewals (scopeValidUntil edits)
 * take effect without restarting the watcher. One bad cycle never kills
 * the loop.
 */
