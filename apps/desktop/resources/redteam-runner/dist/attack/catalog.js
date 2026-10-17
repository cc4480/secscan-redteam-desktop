import { HOST_TECHNIQUES } from "./techniques-host.js";
import { WEB_TECHNIQUES } from "./techniques-web.js";
/** Web techniques first, then host — the original catalog order. */
export const TECHNIQUES = [...WEB_TECHNIQUES, ...HOST_TECHNIQUES];
const byId = new Map(TECHNIQUES.map((t) => [t.id, t]));
export function lookupTechnique(id) {
    return byId.get(id.toUpperCase());
}
/** Technique IDs excluded in every engagement, regardless of ROE. */
export const ALWAYS_EXCLUDED = ["T1499"];
/**
 * Technique IDs excluded by default in black (covert) mode. The operator can
 * narrow this list in the ROE, but cannot remove ALWAYS_EXCLUDED.
 */
export function defaultExcludedForMode(mode) {
    const base = [...ALWAYS_EXCLUDED];
    if (mode === "black")
        base.push("T1110");
    return base;
}
/** Full exclusion set: always-excluded + mode defaults + ROE exclusions (deduped, uppercased). */
export function resolveExcludedTechniques(mode, roeExcluded) {
    const set = new Set([
        ...defaultExcludedForMode(mode),
        ...(roeExcluded ?? []).map((t) => t.toUpperCase()),
    ]);
    return [...set];
}
//# sourceMappingURL=catalog.js.map