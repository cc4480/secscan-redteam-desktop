/**
 * CONTINUOUS TESTING — rolling baseline (v0.16.0).
 *
 * The baseline is the watch profile's memory: every confirmed finding ever
 * seen, keyed stably so it can be matched across runs. Finding IDs (F-1…)
 * are per-run and useless for this; the key is target + sorted ATT&CK IDs,
 * which is what actually identifies "the same vulnerability."
 *
 * The baseline is per-profile and explicit — baselines are never silently
 * merged across different scopes. One profile, one baseline.json, in the
 * profile home directory.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
export const BASELINE_VERSION = 1;
function normalizeTitle(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
}
/**
 * Stable cross-run finding key. ATT&CK IDs are the identity of "the same
 * vulnerability" — titles are LLM-written and drift between runs. When a
 * finding carries no technique IDs, fall back to a normalized title slug
 * (documented limitation: title drift may split or merge these).
 */
export function findingKey(target, f) {
    const t = target.trim().toLowerCase();
    const ids = [...new Set((f.attackIds ?? []).map((a) => a.trim().toUpperCase()).filter(Boolean))].sort();
    if (ids.length > 0)
        return `${t}::${ids.join("+")}`;
    return `${t}::title-${normalizeTitle(f.title ?? "") || "untitled"}`;
}
export function emptyBaseline(profileName) {
    return { version: 1, profileName, updatedAt: new Date().toISOString(), entries: [] };
}
/** Load the baseline, or null when this profile has never run (first cycle). */
export function loadBaseline(path) {
    if (!existsSync(path))
        return null;
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (raw.version !== BASELINE_VERSION || !Array.isArray(raw.entries)) {
        throw new Error(`[watch] bad baseline ${path}: version must be ${BASELINE_VERSION} with an entries array`);
    }
    return raw;
}
export function saveBaseline(path, baseline) {
    mkdirSync(dirname(path), { recursive: true });
    baseline.updatedAt = new Date().toISOString();
    writeFileSync(path, JSON.stringify(baseline, null, 2));
}
/** Where a baseline entry's PoC bundle lives (for reverify of missing findings). */
export function bundlePathFor(runsDir, entry) {
    return join(runsDir, entry.engagementId, "poc", `${entry.findingId}.json`);
}
//# sourceMappingURL=baseline.js.map