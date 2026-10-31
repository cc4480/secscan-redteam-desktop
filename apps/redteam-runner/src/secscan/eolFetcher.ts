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

import { db, eolCacheTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

// ─── pg-boss queue name (imported by worker.ts) ───────────────────────────────

export const EOL_REFRESH_QUEUE = "eol-refresh";

// ─── endoflife.date API response shape ───────────────────────────────────────

interface EolCycle {
  cycle: string;        // "8.3", "1.26", "2.4", …
  releaseDate: string;  // ISO date
  eol: string | false;  // ISO EOL date, or false when still actively supported
  latest: string;       // latest patch release in this cycle
  lts?: boolean;
  support?: string | false;
}

// ─── DB payload shape ─────────────────────────────────────────────────────────
//
// Sets cannot be stored in JSON directly — serialised as sorted string arrays.

interface EolDbPayload {
  phpEol: Record<string, string>;
  nginxEolCycles: string[];
  apacheEolCycles: string[];
}

// ─── Bundled fallback data — mirrors the constants in cveCheck.ts ─────────────
//
// Used when neither in-memory cache nor DB row is available (e.g. first boot
// with no network or DB before the async refresh completes).

const FALLBACK_PHP_EOL: Record<string, string> = {
  "5":   "Reached EOL in December 2018",
  "7.0": "Reached EOL in December 2019",
  "7.1": "Reached EOL in December 2019",
  "7.2": "Reached EOL in November 2020",
  "7.3": "Reached EOL in December 2021",
  "7.4": "Reached EOL in November 2022",
  "8.0": "Reached EOL in November 2023",
  "8.1": "Reached EOL in December 2025",
  "8.2": "Reaches EOL in December 2026",
};

// Nginx stable cycles known to be EOL as of the bundled date (2026-05).
const FALLBACK_NGINX_EOL_CYCLES = new Set([
  "1.14", "1.15", "1.16", "1.17", "1.18", "1.19",
  "1.20", "1.21", "1.22", "1.23", "1.24", "1.25",
]);

// Apache HTTPD branches known to be EOL.
const FALLBACK_APACHE_EOL_CYCLES = new Set(["2.0", "2.2"]);

// ─── In-process cache ─────────────────────────────────────────────────────────

interface EolCache {
  phpEol: Record<string, string>;
  nginxEolCycles: Set<string>;
  apacheEolCycles: Set<string>;
  fetchedAt: Date;
}

let cache: EolCache | null = null;

const EOL_CACHE_KEY = "eol-data";

// ─── Public getters ───────────────────────────────────────────────────────────

/** Returns the timestamp of the last successful EOL data fetch, or null. */
export function getEolDataFetchedAt(): Date | null {
  return cache?.fetchedAt ?? null;
}

/**
 * PHP EOL map keyed by "major.minor" (or "major" for PHP 5.x).
 * Returns live data when available, bundled fallback otherwise.
 */
export function getLivePhpEol(): Record<string, string> {
  return cache?.phpEol ?? FALLBACK_PHP_EOL;
}

/**
 * Set of Nginx release-cycle strings (e.g. "1.24", "1.25") that are EOL.
 * Returns live data when available, bundled fallback otherwise.
 */
export function getLiveNginxEolCycles(): Set<string> {
  return cache?.nginxEolCycles ?? FALLBACK_NGINX_EOL_CYCLES;
}

/**
 * Set of Apache HTTPD release-cycle strings (e.g. "2.2") that are EOL.
 * Returns live data when available, bundled fallback otherwise.
 */
export function getLiveApacheEolCycles(): Set<string> {
  return cache?.apacheEolCycles ?? FALLBACK_APACHE_EOL_CYCLES;
}

// ─── DB persistence ───────────────────────────────────────────────────────────

/**
 * Loads the last-persisted EOL data from the DB and hydrates the in-memory cache.
 * Call this once at startup (before any scans run) so fresh data is available
 * immediately without waiting for a network fetch to endoflife.date.
 */
export async function loadEolCacheFromDb(): Promise<void> {
  try {
    const [row] = await db
      .select()
      .from(eolCacheTable)
      .where(eq(eolCacheTable.key, EOL_CACHE_KEY))
      .limit(1);

    if (!row) {
      logger.debug("[eolFetcher] No persisted EOL data in DB yet — bundled fallback active");
      return;
    }

    const payload = row.payload as EolDbPayload;
    cache = {
      phpEol: payload.phpEol,
      nginxEolCycles: new Set(payload.nginxEolCycles),
      apacheEolCycles: new Set(payload.apacheEolCycles),
      fetchedAt: row.fetchedAt,
    };

    logger.info(
      {
        fetchedAt: row.fetchedAt.toISOString(),
        phpEolEntries: Object.keys(payload.phpEol).length,
        nginxEolCycles: payload.nginxEolCycles.length,
        apacheEolCycles: payload.apacheEolCycles.length,
      },
      "[eolFetcher] Loaded persisted EOL data from DB",
    );
  } catch (err) {
    logger.warn(
      { err },
      "[eolFetcher] Could not load persisted EOL data from DB — bundled fallback active",
    );
  }
}

/** Persists the current cache to the DB (upsert). Errors are non-fatal. */
async function saveEolCacheToDb(c: EolCache): Promise<void> {
  const payload: EolDbPayload = {
    phpEol: c.phpEol,
    nginxEolCycles: Array.from(c.nginxEolCycles).sort(),
    apacheEolCycles: Array.from(c.apacheEolCycles).sort(),
  };

  await db
    .insert(eolCacheTable)
    .values({ key: EOL_CACHE_KEY, payload, fetchedAt: c.fetchedAt })
    .onConflictDoUpdate({
      target: eolCacheTable.key,
      set: { payload, fetchedAt: c.fetchedAt },
    });
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

const EOL_API_TIMEOUT_MS = 10_000;
const EOL_API_BASE = "https://endoflife.date/api";

async function fetchEolCycles(product: string): Promise<EolCycle[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EOL_API_TIMEOUT_MS);
  try {
    const res = await fetch(`${EOL_API_BASE}/${product}.json`, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "VibeScan-SecurityScanner/1.0",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching endoflife.date/${product}`);
    return (await res.json()) as EolCycle[];
  } finally {
    clearTimeout(timer);
  }
}

// ─── Data builders ────────────────────────────────────────────────────────────

/**
 * Builds the PHP EOL map from live endoflife.date data.
 *
 * A PHP cycle is included when:
 *   - Its EOL date has passed        → "Reached EOL in <Month Year>"
 *   - Its EOL date is within 12 mo   → "Reaches EOL in <Month Year>" (early warning)
 *   - Its EOL date is > 12 mo away   → skipped (still comfortably supported)
 */
function buildPhpEolMap(cycles: EolCycle[]): Record<string, string> {
  const map: Record<string, string> = {};
  const now = new Date();
  const twelveMonthsOut = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  for (const c of cycles) {
    if (c.eol === false || !c.eol) continue;
    const eolDate = new Date(c.eol);
    const eolStr = eolDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

    if (eolDate <= now) {
      map[c.cycle] = `Reached EOL in ${eolStr}`;
    } else if (eolDate <= twelveMonthsOut) {
      map[c.cycle] = `Reaches EOL in ${eolStr}`;
    }
  }

  // PHP 5.x predates the endoflife.date dataset; ensure it is always included
  if (!map["5"]) map["5"] = FALLBACK_PHP_EOL["5"]!;

  return map;
}

/**
 * Builds a Set of EOL release-cycle strings for a server product (Nginx, Apache).
 * A cycle is EOL when its eol field is a date string ≤ today.
 */
function buildEolCycleSet(cycles: EolCycle[]): Set<string> {
  const now = new Date();
  const eol = new Set<string>();
  for (const c of cycles) {
    if (typeof c.eol === "string" && new Date(c.eol) <= now) {
      eol.add(c.cycle);
    }
  }
  return eol;
}

// ─── Main refresh function ────────────────────────────────────────────────────

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
export async function refreshEolData(): Promise<void> {
  const log = logger.child({ job: EOL_REFRESH_QUEUE });
  log.info("[eolFetcher] Fetching EOL data from endoflife.date");

  const [phpResult, nginxResult, apacheResult] = await Promise.allSettled([
    fetchEolCycles("php"),
    fetchEolCycles("nginx"),
    fetchEolCycles("apache"),
  ]);

  const failed = (
    [
      phpResult.status === "rejected" ? "php" : null,
      nginxResult.status === "rejected" ? "nginx" : null,
      apacheResult.status === "rejected" ? "apache" : null,
    ] as (string | null)[]
  ).filter((p): p is string => p !== null);

  if (failed.length === 3) {
    // All products failed — do not update cache at all
    log.warn(
      { failed, errors: [phpResult, nginxResult, apacheResult].map((r) => r.status === "rejected" ? String(r.reason) : null) },
      "[eolFetcher] All product fetches failed — last persisted / bundled fallback data remains active",
    );
    return;
  }

  if (failed.length > 0) {
    log.warn(
      { failed },
      `[eolFetcher] Partial fetch — ${failed.join(", ")} failed; succeeded products will update cache`,
    );
  }

  // For failed products, fall back to the last cached or bundled values
  const phpEol =
    phpResult.status === "fulfilled"
      ? buildPhpEolMap(phpResult.value)
      : (cache?.phpEol ?? FALLBACK_PHP_EOL);

  const nginxEolCycles =
    nginxResult.status === "fulfilled"
      ? buildEolCycleSet(nginxResult.value)
      : (cache?.nginxEolCycles ?? FALLBACK_NGINX_EOL_CYCLES);

  const apacheEolCycles =
    apacheResult.status === "fulfilled"
      ? buildEolCycleSet(apacheResult.value)
      : (cache?.apacheEolCycles ?? FALLBACK_APACHE_EOL_CYCLES);

  const fetchedAt = new Date();
  cache = { phpEol, nginxEolCycles, apacheEolCycles, fetchedAt };

  log.info(
    {
      phpEolEntries: Object.keys(phpEol).length,
      nginxEolCycles: nginxEolCycles.size,
      apacheEolCycles: apacheEolCycles.size,
      partialRefresh: failed.length > 0,
      failed: failed.length > 0 ? failed : undefined,
      fetchedAt: fetchedAt.toISOString(),
    },
    "[eolFetcher] EOL data refreshed — persisting to DB",
  );

  // Persist to DB — non-fatal if it fails (in-memory cache is already updated)
  try {
    await saveEolCacheToDb(cache);
    log.info("[eolFetcher] EOL data persisted to DB");
  } catch (dbErr) {
    log.warn(
      { err: dbErr },
      "[eolFetcher] DB persist failed — restart may load stale data",
    );
  }
}
