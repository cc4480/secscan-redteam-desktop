/**
 * CVE / known-vulnerability checker.
 *
 * Extracts software version numbers from page HTML and HTTP headers,
 * then cross-references them against the OSV.dev vulnerability database
 * (https://osv.dev — free, no API key required).
 *
 * Covers: jQuery, Bootstrap, Lodash, Moment.js, Vue.js, Angular,
 * React (CDN-hosted), WordPress, Drupal, Joomla, plus PHP, Nginx,
 * Apache, IIS, OpenResty end-of-life / CVE detection from headers.
 *
 * Results are cached in-process per (package, version, ecosystem) to
 * avoid duplicate OSV.dev API calls within the same server lifetime.
 */
import type { ScanVulnerability } from "./scanner.js";
/**
 * Maximum number of (package, version, ecosystem) entries to keep in memory.
 * Override via OSV_CACHE_MAX_SIZE env var. Falls back to 1000 if unset or invalid.
 * Exported so the worker can log the effective value at startup.
 */
export declare const OSV_CACHE_MAX_SIZE: number;
import { type DetectedVersion } from "./cve-patterns.js";
export declare function extractVersionedTechnologies(html: string, headers: Record<string, string>): DetectedVersion[];
/**
 * Logs a warning at startup when the bundled local CVE / EOL data is older
 * than LOCAL_DATA_STALE_DAYS days. Call this once from startWorker().
 *
 * The warning reminds developers that PHP_EOL, NGINX_VULN_RANGES,
 * APACHE_VULN_RANGES, and IIS_EOL_MAJOR may need refreshing against
 * current vendor advisories and EOL schedules.
 */
export declare function warnIfLocalDataStale(): void;
export declare function checkForKnownVulnerabilities(html: string, headers: Record<string, string>): Promise<ScanVulnerability[]>;
