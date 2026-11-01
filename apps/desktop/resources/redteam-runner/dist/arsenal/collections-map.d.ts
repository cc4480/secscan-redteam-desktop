/**
 * Arsenal collections map — the curated, versioned Level-1 census plus the
 * priority collections' facet baselines (spec §4.4 layer 1).
 *
 * Data source (the ONLY source; nothing here is recalled or padded): the
 * ARS-10 catalog checklist, enumerated from the Awesome Hacking README at
 * pinned commit `440486fd08b0a0d9ad9a041a0bb234dcdf65dee2` and filed at
 * `arsenal-catalog-checklist-2026-10-31.md`. All 81 rows of that census are
 * below, in checklist order, with name/URL character-exact. The stale "~90"
 * figure from the spec/register is NOT chased (ARS-10 FLAG 1, ARS-1 ruling:
 * the crew builds against 81).
 *
 * Slugs follow spec §4.2 as ARS-3's `arsenalSlugFor` implements it: lowercase
 * kebab of the repo name (last URL segment, no camel splitting); a
 * `*.github.io` repo segment strips to the project prefix; site-root URLs
 * fall back to the display name.
 *
 * Facet curation: only the seven priority rows carry curated `topics` /
 * `targets` / `batteryCategories` — the human-set baseline every entry in
 * that collection inherits (spec §4.4). Non-priority rows inherit their
 * Level-1 section topic only, until curated (spec §10: curation of the
 * remaining rows is post-v1).
 */
import type { BatteryCategory } from "../battery.js";
import type { InheritedFacets, TargetPrefix } from "./tag-rules.js";
/** One Level-1 collection row (identity + curated facet baseline). */
export interface ArsenalCollection {
    slug: string;
    /** Display name, character-exact from the pinned census. */
    name: string;
    /** Canonical URL, character-exact from the pinned census. */
    url: string;
    /** Level-1 topic = the README section heading the row sits under (spec §4.2). */
    topic: string;
    /** True for the seven Level-2 priority collections (spec §10). */
    level2: boolean;
    /** Curated facet topics (bare slugs); priority rows only, `[]` until curated. */
    topics: readonly string[];
    /** Curated target-profile baseline; priority rows only, `[]` until curated. */
    targets: readonly TargetPrefix[];
    /** Curated battery-category baseline; priority rows only, `[]` until curated. */
    batteryCategories: readonly BatteryCategory[];
    /** Honesty note (sourcing flags, form caveats) where the census carries one. */
    note?: string;
}
/**
 * The complete Level-1 map: all 81 census rows in checklist order (rows
 * 1–47 "Awesome Repositories", rows 48–81 "Other Useful Repositories").
 */
export declare const COLLECTIONS_MAP: readonly ArsenalCollection[];
/**
 * The canonical priority slug list, in spec §10 order — consumed as
 * `ArsenalBuildData.prioritySlugs` at refresh time (ARS-1 forward contract).
 * The seventh slot is `api-security-checklist` under its real name (ARS-1's
 * corrected FLAG 2 ruling; see that row's note).
 */
export declare const PRIORITY_COLLECTION_SLUGS: readonly string[];
/** The seven priority rows, in {@link PRIORITY_COLLECTION_SLUGS} order. */
export declare const PRIORITY_COLLECTIONS: readonly ArsenalCollection[];
/** Look up one collection row by slug. */
export declare function collectionBySlug(slug: string): ArsenalCollection | undefined;
/**
 * The inherited facets (spec §4.4 layer 1) for one collection: curated facet
 * topics where the row carries them, otherwise the row's Level-1 section
 * topic; the collection slug; and the curated target / battery-category
 * baseline (`[]` until curated). Feed to {@link deriveEntryFacets}.
 */
export declare function inheritedFacetsForCollection(slug: string): InheritedFacets | undefined;
