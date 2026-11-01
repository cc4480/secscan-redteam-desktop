/** Resolved Arsenal configuration; every field validated at load. */
export interface ArsenalConfig {
    /** Tools listed on the console `/mcp` (spec §11). false ⇒ the three tools are absent, not stubs. */
    enabled: boolean;
    /** Absolute path of the serving index database (spec §5). */
    dbPath: string;
    /** `<data-home>/arsenal` — parent of `dbPath`; the refresh cache lives under it. */
    arsenalDir: string;
    /** Refresh clone of the one pinned source repo: `<arsenalDir>/cache/awesome-hacking`. */
    cacheDir: string;
    /** The one git remote the refresh may pull (spec §6.4). Changing it is an operator act. */
    sourceRepo: string;
    /** Refresh timer interval; weekly by default, 0 = manual refresh only. */
    refreshIntervalHours: number;
    /** Ingest bound per collection; overflow is counted in build meta, never silent. */
    maxEntriesPerCollection: number;
}
export declare const DEFAULT_ARSENAL_SOURCE_REPO = "https://github.com/hack-with-github/awesome-hacking.git";
export declare const DEFAULT_ARSENAL_REFRESH_INTERVAL_HOURS = 168;
export declare const DEFAULT_ARSENAL_MAX_ENTRIES_PER_COLLECTION = 20000;
/**
 * Resolve Arsenal configuration.
 *
 * Database path (brief §1.4): `REDTEAM_ARSENAL_DB_PATH` wins; otherwise the
 * path derives from the console's engagements dir
 * (`<engagementsDir>/../../arsenal/arsenal.db`, so the desktop lands at
 * `<userData>/arsenal/arsenal.db`); without an engagements dir it falls
 * back to the console's data-home convention (`REDTEAM_HOME` or cwd).
 * The database never lives under `live/`, a payload dir, or an XDG path.
 */
export declare function resolveArsenalConfig(env: NodeJS.ProcessEnv, opts?: {
    engagementsDir?: string;
}): ArsenalConfig;
/**
 * Resolve the config the SERVING surface (the console's Arsenal tools)
 * reads through.
 *
 * The primary resolution ({@link resolveArsenalConfig}) names the
 * canonical index path — the one a refresh creates and writes. When no
 * index exists there yet, an index that DOES exist at the runner's other
 * data-home conventions is the real one to serve: `$REDTEAM_HOME/arsenal/
 * arsenal.db` (where the production census is built and where a
 * standalone console with no engagements dir resolves its index), then
 * `<cwd>/arsenal/arsenal.db` (the remaining data-home fallback in
 * resolveEngagementsDir/resolveConfig). Serving the primary path in that
 * situation renders an empty census while a real index sits one
 * convention away. When no index exists anywhere, the primary config
 * stands unchanged, so the tools keep answering the typed
 * ARSENAL_INDEX_EMPTY result and a later refresh still lands at the
 * canonical path. Refresh and the CLI always use the primary resolution —
 * this fallback never redirects a write.
 *
 * @param env - The process environment to resolve from.
 * @param opts - The console's engagements dir, when the caller holds one.
 * @returns The primary config, or that config re-pointed at the first
 * existing index found at a fallback convention.
 */
export declare function resolveArsenalServingConfig(env: NodeJS.ProcessEnv, opts?: {
    engagementsDir?: string;
}): ArsenalConfig;
