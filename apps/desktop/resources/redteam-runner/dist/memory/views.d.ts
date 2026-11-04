/**
 * L0/L1 views (brief §5): generated projections over the L2 originals in
 * `units.jsonl` — never canonical, never a second store. The v1 generator
 * is deterministic code (`deterministic-v1`): it may only compress the
 * unit's own fields, never add facts, and a view that exceeds its budget
 * is a generator bug that fails loud (`VIEW_BUDGET_EXCEEDED`), never an
 * oversized view that ships. Freshness is bookkeeping, not silence: a
 * stale directory view stays readable and says so, in `views.json`, in
 * the recall receipt, and in the pack header.
 */
import type { MemoryPaths } from './paths.js';
import type { DirectoryFreshness, MemoryUnit, MemoryUnitStatus } from './types.js';
import type { MemoryStore } from './store.js';
export { VIEW_GENERATOR_VERSION, L0_BUDGET, L1_BUDGET, atomicWriteText, emptyViewsIndex, readViewsIndex, writeViewsIndex, unitViewSourceHash, type ViewsIndexFile } from './views-core.js';
export declare function generateUnitViews(unit: Omit<MemoryUnit, 'views' | 'hash'>, status?: MemoryUnitStatus): {
    l0: string;
    l1: string;
};
/**
 * The human-readable Markdown projection of one unit (§2.2): a
 * front-matter-style header (id, kind, tier, scope, receipt refs) over
 * the L2 body. Generated, never canonical.
 *
 * @param unit - The unit, with fresh views.
 * @param status - The unit's current status.
 * @returns The Markdown file body.
 */
export declare function renderUnitMarkdown(unit: MemoryUnit, status: MemoryUnitStatus): string;
/** The on-disk path of a unit's Markdown projection. */
export declare function unitViewPath(paths: MemoryPaths, unit: MemoryUnit): string;
/** The on-disk paths of a directory's `.abstract.md` / `.overview.md`. */
export declare function directoryViewPaths(paths: MemoryPaths, dirKey: string): {
    abstractPath: string;
    overviewPath: string;
};
/**
 * The directory `.abstract.md`: counts by tier plus the single
 * highest-trust unit's L0.
 *
 * @param dirKey - The directory identity.
 * @param units - The directory's ACTIVE units.
 * @returns The abstract file body.
 */
export declare function renderDirectoryAbstract(dirKey: string, units: readonly MemoryUnit[]): string;
/**
 * The directory `.overview.md`: every active unit's L0 with its tier.
 * Overflow units are demoted to URI-only lines and the overview says so —
 * truncation is announced, never silent (§5.1).
 *
 * @param dirKey - The directory identity.
 * @param units - The directory's ACTIVE units.
 * @returns The overview file body.
 */
export declare function renderDirectoryOverview(dirKey: string, units: readonly MemoryUnit[]): string;
/**
 * Refresh one directory view end-to-end: rewrite every active unit's
 * Markdown projection (regenerating views whose stored copy no longer
 * matches the current version), rewrite `.abstract.md`/`.overview.md`,
 * and update the freshness entry (covered = total, pending = 0).
 *
 * @param store - The open store.
 * @param dirKey - The directory to refresh.
 * @param nowIso - Timestamp for the freshness entry.
 * @returns The updated freshness entry.
 */
export declare function refreshDirectoryView(store: MemoryStore, dirKey: string, nowIso: string): DirectoryFreshness;
/**
 * The mechanical refresh recall runs before reading (§5.2): unit views
 * are hash-checked against the current version — a mismatch regenerates
 * deterministically (the ledger record is never rewritten; the Markdown
 * projection and the returned refresh list carry the regeneration) —
 * and directory views refresh per §5.3's thresholds. Below threshold a
 * directory stays stale-but-readable and is named in `staleDirs`.
 *
 * @param store - The open store.
 * @param dirs - Directories to ensure (default: every directory holding
 *   units, plus every indexed directory).
 * @param nowIso - Timestamp for refreshes (default: now).
 * @returns The unit ids refreshed, the directories refreshed, and the
 *   directories left stale.
 */
export declare function ensureViews(store: MemoryStore, dirs?: string[], nowIso?: string): {
    refreshedUnitIds: string[];
    refreshedDirs: string[];
    staleDirs: string[];
};
