/**
 * Battery-item and battery-category tag rules — extracted from
 * `tag-rules.ts` (via the rule table) to keep every module inside the
 * runner's 300-line file budget. Pure data, spec §4.4 layer 2; the parent
 * concatenates this table with the target/free-tag table, order preserved.
 */
import type { TagRule } from "./tag-rules.js";
export declare const BATTERY_AND_CATEGORY_RULES: readonly TagRule[];
