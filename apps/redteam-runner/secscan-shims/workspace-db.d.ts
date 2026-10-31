/**
 * Compile-time surface for the embedded @workspace/db runtime shim
 * (secscan-vendor/@workspace/db).
 *
 * The vendored SecScan engine's eolFetcher.ts persists its EOL cache
 * through the SecScan service's Drizzle database. The embedded build has
 * no database: the runtime shim's query chains resolve to empty results,
 * which is exactly the engine's own documented fallback path ("bundled
 * fallback active"). `db` is typed `any` because the Drizzle query
 * builder surface is an open-ended chain this stub deliberately does not
 * model — the only contract the engine relies on is "awaiting any chain
 * yields an empty/undefined result and never throws at import time".
 */
export declare const db: any;

/** Table handle — the engine reads only `.key` (for eq/onConflictDoUpdate). */
export declare const eolCacheTable: { key: string };
