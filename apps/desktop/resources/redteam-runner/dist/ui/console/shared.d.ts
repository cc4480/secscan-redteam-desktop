/**
 * Operator console — shared path resolution and safe file readers.
 *
 * The console renders only what the artifacts on disk say. Every reader here
 * fails soft (null / empty) instead of throwing, and every path that cannot
 * be resolved comes back null so the route can answer
 * { available: false, reason } rather than fabricating data.
 *
 * Imports are limited to node builtins plus a type-only UiStore reference:
 * this module must stay loadable in isolation (see the package's pre-existing
 * src/coverage gap — runtime imports beyond the UI's own http helpers break
 * standalone verification of the console routes).
 */
import type { UiStore } from '../store.js'
/** Resolved data-source locations for the console API. Null = not present. */
export interface ConsolePaths {
  /** Engagement run dirs (run.json, events.jsonl, report.md, …). */
  engagementsDir: string
  /** Harness2 (TS) layers dir: per-layer meta.json + active.json. */
  layersDir: string | null
  /** Parent of layersDir — where EXPERIENCE.md / regression output live. */
  harness2Root: string | null
  /** Python harness2 layer_registry.json (on Looko), when configured. */
  pyRegistryPath: string | null
  /** Benchmark suite dir (HISTORY.md + scored run JSONs), when configured. */
  benchmarkDir: string | null
}
/**
 * Resolve the console's data sources from the store + environment.
 *
 * - engagementsDir always comes from the store.
 * - layersDir: REDTEAM_LAYERS_DIR, else <engagementsDir>/../harness2/layers
 *   when that directory exists, else null.
 * - harness2Root: REDTEAM_HARNESS2_ROOT, else the parent of layersDir.
 * - pyRegistryPath: REDTEAM_PY_REGISTRY (a layer_registry.json path), else null.
 * - benchmarkDir: REDTEAM_BENCHMARK_DIR, else null.
 */
export declare function consolePaths(store: UiStore): ConsolePaths
/** existsSync that never throws (bad paths read as absent). */
export declare function existsSafe(path: string): boolean
/** Parse a JSON file; null when missing, unreadable, or invalid. */
export declare function readJsonSafe(path: string): unknown | null
/**
 * Read a text file, capped at maxBytes (the first maxBytes win — callers that
 * need the tail of a file use readJsonlTail). Null when missing/unreadable.
 */
export declare function readTextSafe(path: string, maxBytes: number): string | null
/**
 * Parse a JSONL file and return the last maxLines objects. Lines that fail
 * to parse (e.g. a torn final line in a file still being written) are
 * skipped; a missing file reads as []. Reads at most the first 8 MiB — the
 * console only ever displays recent activity, and engagement event logs in
 * practice stay well under the cap.
 */
export declare function readJsonlTail(path: string, maxLines: number): unknown[]
/** Sorted names of the directories directly under path; [] when absent. */
export declare function listSubdirs(path: string): string[]
/** First 12 hex chars of the sha256 of a string — display-grade fingerprint. */
export declare function shortHash(text: string): string
