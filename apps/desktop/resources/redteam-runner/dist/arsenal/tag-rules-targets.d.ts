/**
 * Target-prefix and free-tag rules — extracted from `tag-rules.ts` (via the
 * rule table) to keep every module inside the runner's 300-line file
 * budget. Pure data, spec §4.4 layer 2; concatenated after the battery
 * table by the parent.
 */
import type { TagRule } from "./tag-rules.js";
export declare const TARGET_AND_TAG_RULES: readonly TagRule[];
