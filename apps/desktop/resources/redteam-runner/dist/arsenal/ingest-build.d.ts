import type { ArsenalConfig } from './config.js';
import { type FetchTextResult } from './fetch-guard.js';
import type { ArsenalBuildData } from './index-store.js';
/** The Level 2 fetch seam: fetch-guard's one function, injectable for tests. */
export type ArsenalFetchText = (url: string) => Promise<FetchTextResult>;
export interface BuildArsenalDataDeps {
    /** Defaults to {@link fetchTextChecked} — the guard is the only network path. */
    fetchText?: ArsenalFetchText;
    /** Build clock; the reading is stamped on every fetched collection. */
    now?: () => Date;
}
/**
 * The raw-markdown source URL for one collection (spec §4.1): a GitHub repo
 * serves its README from the raw host at the default-branch HEAD; any other
 * canonical URL (a project site — GTFOBins) is itself the Level 2 source,
 * the site index at that URL (ARS-1's FLAG 3 ruling).
 */
export declare function arsenalReadmeUrl(collectionUrl: string): string;
/**
 * Assemble one generation's build data (the refresh pipeline's single build
 * entry — refresh.ts imports this by name and fails loud while it is absent).
 *
 * Level 1 is the census parsed from the cached Awesome Hacking README at
 * `cacheDir/README.md`; a missing census is a hard failure (throw), because
 * a generation without its census is not a generation. Level 2 runs for the
 * canonical priority set (collections-map.ts), joined to census rows by
 * slug; a priority slug the census does not carry falls back to its curated
 * map row, so the priority set is never silently short. Each priority
 * README comes through fetch-guard and only fetch-guard; a fetch failure or
 * a zero-entry parse is recorded on the collection row (`fetchError`), never
 * thrown — the store's validation decides whether the swap may proceed
 * (spec §4.3).
 *
 * Entries are facet-enriched at assembly (spec §4.4: the map's inherited
 * facets unioned with the tag rules) and deduped across the whole
 * generation by normalized URL, first occurrence in priority order wins.
 * Count folding at this seam (the store's meta carries two counters):
 * URL-less items and per-collection cap overflow fold into `unparsedCount`
 * alongside true unparsed items, so stored + dupes + unparsed reconciles
 * against items seen at every level.
 */
export declare function buildArsenalData(input: {
    config: ArsenalConfig;
    cacheDir: string;
    sourceCommit: string;
}, deps?: BuildArsenalDataDeps): Promise<ArsenalBuildData>;
