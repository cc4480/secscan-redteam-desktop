/**
 * Memory store addressing (brief §3.1/§3.2): the on-disk layout under the
 * memory root and the `memory://` URIs that provenance and receipts cite.
 * The root itself is resolved by the caller (config: sibling of the
 * registry file, `REDTEAM_MEMORY_ROOT` / `RunOptions.memoryRoot` override);
 * this module only maps a root to its files and builds addresses.
 */
import type { MemoryScope } from "./types.js";
/** Every file and directory of the memory store, resolved from its root. */
export interface MemoryPaths {
    root: string;
    manifestPath: string;
    /** Canonical append-only unit ledger — one JSON object per unit VERSION. */
    unitsPath: string;
    /** Status overlay (§4.4) — one line per status transition. */
    commitsPath: string;
    viewsIndexPath: string;
    lockPath: string;
    viewsDir: string;
    archivesDir: string;
    proposalsDir: string;
    recallDir: string;
}
/**
 * Resolve every store path from the memory root.
 *
 * @param root - The memory root directory (need not exist yet).
 * @returns The store's full path set.
 */
export declare function resolveMemoryPaths(root: string): MemoryPaths;
/**
 * The `memory://` URI for a unit, by its scope kind (§3.2).
 *
 * @param scope - The unit's scope.
 * @param unitId - The unit id.
 * @returns The unit URI cited in provenance and receipts.
 */
export declare function unitUri(scope: MemoryScope, unitId: string): string;
/**
 * The `memory://` URI for one engagement archive (§3.2).
 *
 * @param engagementId - The archived engagement.
 * @param archiveSeq - The per-engagement archive sequence number.
 * @returns The archive URI.
 */
export declare function archiveUri(engagementId: string, archiveSeq: number): string;
/**
 * The `memory://` URI for a memory diff (§3.2).
 *
 * @param diffId - The diff id (`<engagementId>-<archiveSeq>`).
 * @returns The diff URI.
 */
export declare function diffUri(diffId: string): string;
/**
 * The on-disk directory name for an archive sequence (`archive-0007`).
 *
 * @param archiveSeq - The per-engagement archive sequence number.
 * @returns The directory name under `archives/<engagementId>/`.
 */
export declare function archiveDirName(archiveSeq: number): string;
/**
 * The `views.json` directory identity for a scope (§5.3): the directory a
 * unit's views roll up into.
 *
 * @param scope - The unit's scope.
 * @returns `scope/<scopeKey>`, `class/<targetClass>`, or `global`.
 */
export declare function directoryKey(scope: MemoryScope): string;
