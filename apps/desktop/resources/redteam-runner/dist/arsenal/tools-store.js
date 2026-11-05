import { resolveArsenalServingConfig } from './config.js';
import { openArsenalServingStore, } from './index-store.js';
/** The fix string every empty-index answer carries (spec §7.1). */
export const ARSENAL_EMPTY_FIX = 'Run: redteam-runner arsenal refresh';
export const TARGET_IDS = ['SS', 'SL', 'WA', 'WS', 'LX'];
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;
/* ------------------------------------------------------------------ */
/* Config + serving-store plumbing                                     */
/* ------------------------------------------------------------------ */
let boundConfig;
let servingStore;
/**
 * Bind the config the endpoint resolved for this server (ARS-1's seam calls
 * this with `resolveArsenalServingConfig(process.env, { engagementsDir })`,
 * so the DB path follows the console's real engagements dir — brief §1.4).
 * Until bound, handlers resolve from the process env on every call.
 */
export function bindArsenalConfig(config) {
    boundConfig = config;
    servingStore = undefined;
}
function currentConfig() {
    return boundConfig ?? resolveArsenalServingConfig(process.env);
}
/** The serving generation's handle + meta, or null when no index exists. */
export function serving() {
    const config = currentConfig();
    if (servingStore === undefined || servingStore.dbPath !== config.dbPath) {
        servingStore?.close();
        servingStore = openArsenalServingStore(config.dbPath);
    }
    return servingStore.current();
}
export function emptyIndexResult() {
    return JSON.stringify({
        error: { code: 'ARSENAL_INDEX_EMPTY', fix: ARSENAL_EMPTY_FIX },
    });
}
export function indexStamp(meta) {
    return {
        generation: meta.generation,
        built_at: meta.builtAt,
        source_commit: meta.sourceCommit,
    };
}
//# sourceMappingURL=tools-store.js.map