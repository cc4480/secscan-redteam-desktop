import type { MemoryPaths } from './paths.js';
import type { DirectoryFreshness, MemoryUnit } from './types.js';
export declare const VIEW_GENERATOR_VERSION = "deterministic-v1";
export declare const L0_BUDGET = 256;
export declare const L1_BUDGET = 4000;
/** Write a tmp file then rename (unlink-then-rename fallback on Windows) — the trajectory-write.ts pattern. */
export declare function atomicWriteText(path: string, body: string): void;
/** The `views.json` file: directory freshness entries by directory key. */
export interface ViewsIndexFile {
    version: 1;
    dirs: Record<string, DirectoryFreshness>;
}
/** An empty freshness index (a freshly bootstrapped store). */
export declare function emptyViewsIndex(): ViewsIndexFile;
/**
 * Read `views.json`. A missing file reads as an empty index here; whether
 * missing is an error is the caller's decision (store open treats it as
 * `STORE_INDEX_MISMATCH`, §8 row 4). A malformed file is always that error.
 *
 * @param paths - The store paths.
 * @returns The parsed index.
 */
export declare function readViewsIndex(paths: MemoryPaths): ViewsIndexFile;
/** Persist the freshness index atomically. */
export declare function writeViewsIndex(paths: MemoryPaths, index: ViewsIndexFile): void;
/**
 * The hash a unit's views are bound to: sha256 over the canonical record
 * excluding the `views` and `hash` fields. A mismatch at recall means the
 * stored views do not describe the current version (§8 row 9).
 *
 * @param unit - The unit (any views/hash values are ignored).
 * @returns The source hash for view generation.
 */
export declare function unitViewSourceHash(unit: Omit<MemoryUnit, 'hash'>): string;
export declare function truncateAtWord(text: string, budget: number): string;
/**
 * Generate the L0/L1 pair for a unit from its structured fields only.
 * L0 is one compressed sentence built from the claim; L1 is the fixed
 * Claim/Scope/Proof/Corroboration/Applicability/Caveats structure.
 * Target-derived units are prefixed `UNTRUSTED:` in L0 and carry the
 * caveat in L1 — a target's claim is never presented as fleet knowledge.
 *
 * @param unit - The unit's content fields (views/hash are not read).
 * @param status - The unit's current status, for the Caveats section.
 * @returns The generated `l0` and `l1` strings.
 */
