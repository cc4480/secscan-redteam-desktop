import type { AttackTechnique } from "./techniques-web.js";
import type { EngagementMode } from "../types.js";
/** Web techniques first, then host — the original catalog order. */
export declare const TECHNIQUES: AttackTechnique[];
export type { AttackTechnique, NoiseLevel } from "./techniques-web.js";
export declare function lookupTechnique(id: string): AttackTechnique | undefined;
/** Technique IDs excluded in every engagement, regardless of ROE. */
export declare const ALWAYS_EXCLUDED: string[];
/**
 * Technique IDs excluded by default in black (covert) mode. The operator can
 * narrow this list in the ROE, but cannot remove ALWAYS_EXCLUDED.
 */
export declare function defaultExcludedForMode(mode: EngagementMode): string[];
/** Full exclusion set: always-excluded + mode defaults + ROE exclusions (deduped, uppercased). */
export declare function resolveExcludedTechniques(mode: EngagementMode, roeExcluded: string[] | null | undefined): string[];
