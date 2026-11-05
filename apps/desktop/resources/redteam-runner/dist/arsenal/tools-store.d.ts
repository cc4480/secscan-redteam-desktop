/**
 * Serving-store plumbing and shared bounds — extracted from `tools.ts` so
 * every module stays inside the runner's 300-line file budget. Binds the
 * endpoint's config (ARS-1), opens the serving generation lazily, and owns
 * the empty-index envelope every tool answers with.
 */
import type { DatabaseSync } from 'node:sqlite';
import { type ArsenalConfig } from './config.js';
import { type ArsenalIndexMeta } from './index-store.js';
/** The fix string every empty-index answer carries (spec §7.1). */
export declare const ARSENAL_EMPTY_FIX = "Run: redteam-runner arsenal refresh";
export declare const TARGET_IDS: readonly ["SS", "SL", "WA", "WS", "LX"];
export declare const DEFAULT_LIMIT = 10;
export declare const MAX_LIMIT = 50;
/**
 * Bind the config the endpoint resolved for this server (ARS-1's seam calls
 * this with `resolveArsenalServingConfig(process.env, { engagementsDir })`,
 * so the DB path follows the console's real engagements dir — brief §1.4).
 * Until bound, handlers resolve from the process env on every call.
 */
export declare function bindArsenalConfig(config: ArsenalConfig): void;
/** The serving generation's handle + meta, or null when no index exists. */
export declare function serving(): {
    db: DatabaseSync;
    meta: ArsenalIndexMeta;
} | null;
export declare function emptyIndexResult(): string;
export declare function indexStamp(meta: ArsenalIndexMeta): Record<string, unknown>;
