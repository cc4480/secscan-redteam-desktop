/**
 * Memory store addressing (brief §3.1/§3.2): the on-disk layout under the
 * memory root and the `memory://` URIs that provenance and receipts cite.
 * The root itself is resolved by the caller (config: sibling of the
 * registry file, `REDTEAM_MEMORY_ROOT` / `RunOptions.memoryRoot` override);
 * this module only maps a root to its files and builds addresses.
 */
import { join } from "node:path";
/**
 * Resolve every store path from the memory root.
 *
 * @param root - The memory root directory (need not exist yet).
 * @returns The store's full path set.
 */
export function resolveMemoryPaths(root) {
    return {
        root,
        manifestPath: join(root, "manifest.json"),
        unitsPath: join(root, "units.jsonl"),
        commitsPath: join(root, "commits.jsonl"),
        viewsIndexPath: join(root, "views.json"),
        lockPath: join(root, "memory.lock"),
        viewsDir: join(root, "views"),
        archivesDir: join(root, "archives"),
        proposalsDir: join(root, "proposals"),
        recallDir: join(root, "recall"),
    };
}
/**
 * The `memory://` URI for a unit, by its scope kind (§3.2).
 *
 * @param scope - The unit's scope.
 * @param unitId - The unit id.
 * @returns The unit URI cited in provenance and receipts.
 */
export function unitUri(scope, unitId) {
    if (scope.kind === "engagement-target")
        return `memory://scope/${scope.scopeKey}/unit/${unitId}`;
    if (scope.kind === "target-class")
        return `memory://class/${scope.targetClass}/unit/${unitId}`;
    return `memory://global/unit/${unitId}`;
}
/**
 * The `memory://` URI for one engagement archive (§3.2).
 *
 * @param engagementId - The archived engagement.
 * @param archiveSeq - The per-engagement archive sequence number.
 * @returns The archive URI.
 */
export function archiveUri(engagementId, archiveSeq) {
    return `memory://archive/${engagementId}/${archiveSeq}`;
}
/**
 * The `memory://` URI for a memory diff (§3.2).
 *
 * @param diffId - The diff id (`<engagementId>-<archiveSeq>`).
 * @returns The diff URI.
 */
export function diffUri(diffId) {
    return `memory://diff/${diffId}`;
}
/**
 * The on-disk directory name for an archive sequence (`archive-0007`).
 *
 * @param archiveSeq - The per-engagement archive sequence number.
 * @returns The directory name under `archives/<engagementId>/`.
 */
export function archiveDirName(archiveSeq) {
    return `archive-${String(archiveSeq).padStart(4, "0")}`;
}
/**
 * The `views.json` directory identity for a scope (§5.3): the directory a
 * unit's views roll up into.
 *
 * @param scope - The unit's scope.
 * @returns `scope/<scopeKey>`, `class/<targetClass>`, or `global`.
 */
export function directoryKey(scope) {
    if (scope.kind === "engagement-target")
        return `scope/${scope.scopeKey}`;
    if (scope.kind === "target-class")
        return `class/${scope.targetClass}`;
    return "global";
}
//# sourceMappingURL=paths.js.map