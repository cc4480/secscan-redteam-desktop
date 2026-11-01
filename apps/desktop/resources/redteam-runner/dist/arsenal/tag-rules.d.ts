import { TARGET_PREFIXES } from "../targets/types.js";
/** A target-profile prefix: one of `SS | SL | WA | WS | LX`. */
export type TargetPrefix = (typeof TARGET_PREFIXES)[keyof typeof TARGET_PREFIXES];
/** The three facet sets an entry (or a task text) carries. Always sorted + deduped. */
export interface ArsenalFacets {
    tags: string[];
    targets: string[];
    battery: string[];
}
/**
 * Facets an entry inherits before rules run (spec §4.4 layer 1): the
 * collection's facet topics, its slug, and its curated targets / battery
 * categories from `collections-map.ts`.
 */
export interface InheritedFacets {
    /** Bare topic slugs (e.g. `"osint"`); stored as `topic:<slug>` tags. */
    topics?: readonly string[];
    /** Stored as the `collection:<slug>` tag. */
    collectionSlug?: string;
    targets?: readonly string[];
    battery?: readonly string[];
}
/** One keyword rule. `pattern` is matched case-insensitively over free text. */
export interface TagRule {
    /** Stable rule id (tests and review reference rules by id). */
    id: string;
    pattern: RegExp;
    addTargets?: readonly TargetPrefix[];
    addBattery?: readonly string[];
    /** Tags in stored form (see header). */
    addTags?: readonly string[];
}
/** Every battery facet value a rule may honestly name: categories + item ids. */
export declare const BATTERY_FACET_VALUES: ReadonlySet<string>;
/** Every target prefix a rule may name. */
export declare const TARGET_PREFIX_VALUES: ReadonlySet<string>;
/**
 * The ordered rule table (spec §4.4 layer 2). Order is documentation-only:
 * outputs are sorted sets, so application order is unobservable. Patterns
 * never carry the global flag (a stateful `lastIndex` would break purity).
 */
export declare const TAG_RULES: readonly TagRule[];
/**
 * Run the rule table over free text (spec §7.4: the `arsenal_recommend`
 * derivation over the caller's task text; also the rules half of entry
 * tagging). Pure: no inherited facets, no I/O, deterministic.
 */
export declare function deriveFacets(text: string): ArsenalFacets;
/**
 * Tag one index entry (spec §4.4): the inherited collection facets are
 * unioned with the rule facets over `name + " " + description`. Rules only
 * ADD — an inherited facet survives even when no rule fires.
 */
export declare function deriveEntryFacets(entry: {
    name: string;
    description?: string | null;
}, inherited?: InheritedFacets): ArsenalFacets;
