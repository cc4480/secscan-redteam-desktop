/**
 * Arsenal tagging — deterministic keyword → facet rules (spec §4.4).
 *
 * Pure functions only: no I/O, no clocks, no randomness. The same text always
 * derives the same facets, which is what makes `arsenal_recommend` replayable
 * and its `why` facets honest (spec §7.4/T10).
 *
 * Facet vocabulary (stored forms — exactly what lands in the `entries` table):
 * - `targets`: target-profile prefixes from `targets/types.ts`
 *   (`SS` secscan · `SL` seclayer · `WA` webapp · `WS` windows · `LX` linux).
 * - `battery`: battery categories (`logic` | `functionality` | `validation`)
 *   and/or item ids (`L-1`…`L-8`, `F-1`…`F-12`, `V-1`…`V-8`) from
 *   `battery.ts`. Category-level is the default; item-level only on a
 *   specific keyword hit. A rule that names an item also yields the item's
 *   category (the engine adds it), so a category filter finds item-tagged
 *   entries.
 * - `tags`: free facet strings in stored form — bare tags (`wordlist`,
 *   `payloads`) plus the prefixed inheritances (`topic:<topic>`,
 *   `collection:<slug>`) when a rule names a topic.
 *
 * Rules only ADD facets. Inherited facets (from `collections-map.ts`) are
 * unioned in by {@link deriveEntryFacets} and are never removed.
 */
import {
  BATTERY,
  BATTERY_CATEGORIES,
  type BatteryCategory,
} from "../battery.js";
import { TARGET_PREFIXES } from "../targets/types.js";
import { BATTERY_AND_CATEGORY_RULES } from "./tag-rules-battery.js";
import { TARGET_AND_TAG_RULES } from "./tag-rules-targets.js";

/** A target-profile prefix: one of `SS | SL | WA | WS | LX`. */
export type TargetPrefix =
  (typeof TARGET_PREFIXES)[keyof typeof TARGET_PREFIXES];

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
export const BATTERY_FACET_VALUES: ReadonlySet<string> = new Set([
  ...BATTERY_CATEGORIES,
  ...BATTERY.map((item) => item.id),
]);

/** Every target prefix a rule may name. */
export const TARGET_PREFIX_VALUES: ReadonlySet<string> = new Set(
  Object.values(TARGET_PREFIXES),
);

const ITEM_CATEGORY: ReadonlyMap<string, BatteryCategory> = new Map(
  BATTERY.map((item) => [item.id, item.category]),
);

/**
 * The ordered rule table (spec §4.4 layer 2). Order is documentation-only:
 * outputs are sorted sets, so application order is unobservable. Patterns
 * never carry the global flag (a stateful `lastIndex` would break purity).
 */
export const TAG_RULES: readonly TagRule[] = [
  ...BATTERY_AND_CATEGORY_RULES,
  ...TARGET_AND_TAG_RULES,
];

function addBatteryValue(out: Set<string>, value: string): void {
  out.add(value);
  const category = ITEM_CATEGORY.get(value);
  if (category !== undefined) out.add(category);
}

function sorted(set: Set<string>): string[] {
  return [...set].sort();
}

/**
 * Run the rule table over free text (spec §7.4: the `arsenal_recommend`
 * derivation over the caller's task text; also the rules half of entry
 * tagging). Pure: no inherited facets, no I/O, deterministic.
 */
export function deriveFacets(text: string): ArsenalFacets {
  const tags = new Set<string>();
  const targets = new Set<string>();
  const battery = new Set<string>();
  for (const rule of TAG_RULES) {
    if (!rule.pattern.test(text)) continue;
    for (const tag of rule.addTags ?? []) tags.add(tag);
    for (const target of rule.addTargets ?? []) targets.add(target);
    for (const value of rule.addBattery ?? []) addBatteryValue(battery, value);
  }
  return { tags: sorted(tags), targets: sorted(targets), battery: sorted(battery) };
}

/**
 * Tag one index entry (spec §4.4): the inherited collection facets are
 * unioned with the rule facets over `name + " " + description`. Rules only
 * ADD — an inherited facet survives even when no rule fires.
 */
export function deriveEntryFacets(
  entry: { name: string; description?: string | null },
  inherited?: InheritedFacets,
): ArsenalFacets {
  const tags = new Set<string>();
  const targets = new Set<string>();
  const battery = new Set<string>();
  if (inherited !== undefined) {
    for (const topic of inherited.topics ?? []) tags.add(`topic:${topic}`);
    if (inherited.collectionSlug !== undefined && inherited.collectionSlug !== "") {
      tags.add(`collection:${inherited.collectionSlug}`);
    }
    for (const target of inherited.targets ?? []) targets.add(target);
    for (const value of inherited.battery ?? []) addBatteryValue(battery, value);
  }
  const ruled = deriveFacets(`${entry.name} ${entry.description ?? ""}`);
  for (const tag of ruled.tags) tags.add(tag);
  for (const target of ruled.targets) targets.add(target);
  for (const value of ruled.battery) battery.add(value);
  return { tags: sorted(tags), targets: sorted(targets), battery: sorted(battery) };
}
