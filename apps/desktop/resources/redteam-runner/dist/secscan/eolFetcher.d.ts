/**
 * EOL data fetcher — pulls end-of-life schedules from the endoflife.date API,
 * persists them to the `eol_cache` DB table, and caches them in-process.
 *
 * Three products are fetched in parallel: PHP, Nginx, Apache HTTPD.
 *
 * Persistence strategy:
 *   1. On server startup, `loadEolCacheFromDb()` hydrates the in-memory cache
 *      from the last successful DB write — no network call required.
 *   2. After each successful fetch, `refreshEolData()` writes the full payload
 *      to the DB (upsert on key = "eol-data") so it survives future restarts.
 *   3. The in-memory cache is the hot path for scan-time reads; the DB is the
 *      durable source-of-truth loaded once per process lifetime.
 *
 * Refresh cadence:
 *   • At server startup — `loadEolCacheFromDb()` + non-blocking fetch to freshen
 *   • Daily at 03:00 UTC — pg-boss cron job (EOL_REFRESH_QUEUE)
 *
 * Failure handling:
 *   • Fetch errors → cache is NOT updated; bundled fallback (or last DB load) used
 *   • DB write errors → logged at WARN; in-memory cache is still updated so the
 *     current process has fresh data even if persistence failed
 *   • DB load errors → logged at WARN; fallback to bundled tables
 */
export declare const EOL_REFRESH_QUEUE = "eol-refresh";
/** Returns the timestamp of the last successful EOL data fetch, or null. */
export declare function getEolDataFetchedAt(): Date | null;
/**
 * PHP EOL map keyed by "major.minor" (or "major" for PHP 5.x).
 * Returns live data when available, bundled fallback otherwise.
 */
export declare function getLivePhpEol(): Record<string, string>;
/**
 * Set of Nginx release-cycle strings (e.g. "1.24", "1.25") that are EOL.
 * Returns live data when available, bundled fallback otherwise.
 */
export declare function getLiveNginxEolCycles(): Set<string>;
/**
 * Set of Apache HTTPD release-cycle strings (e.g. "2.2") that are EOL.
 * Returns live data when available, bundled fallback otherwise.
 */
export declare function getLiveApacheEolCycles(): Set<string>;
/**
 * Loads the last-persisted EOL data from the DB and hydrates the in-memory cache.
 * Call this once at startup (before any scans run) so fresh data is available
 * immediately without waiting for a network fetch to endoflife.date.
 */
export declare function loadEolCacheFromDb(): Promise<void>;
/**
 * Fetches current EOL data for PHP, Nginx, and Apache from endoflife.date,
 * updates the in-memory cache, and persists the result to the DB.
 *
 * Uses Promise.allSettled so that a single provider failure is non-fatal:
 * the successfully fetched products still update the cache, while failed
 * products retain their last known-good (DB-loaded or bundled) values.
 *
 * Called:
 *   - At startup (non-blocking void call from worker.ts, after DB load)
 *   - Daily via pg-boss schedule (EOL_REFRESH_QUEUE)
 *
 * On all-product failure: cache not updated; DB-loaded or bundled data stays.
 * On DB write failure: in-memory cache IS updated; WARN logged.
 */
export declare function refreshEolData(): Promise<void>;
