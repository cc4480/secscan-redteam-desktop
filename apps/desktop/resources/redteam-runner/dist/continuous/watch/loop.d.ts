/**
 * Loop watch cycles on the profile's cadence until aborted.
 */
import type { WatchCycleOptions } from "./types.js";
export declare function watchLoop(opts: WatchCycleOptions, signal?: AbortSignal): Promise<void>;
