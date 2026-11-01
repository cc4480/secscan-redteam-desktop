/**
 * Source map exposure check.
 *
 * Bundlers (webpack, Vite, esbuild, Parcel) optionally emit .map files that
 * contain the full un-minified source — identical to shipping your source code.
 * These are frequently deployed to production by accident.
 *
 * Approach:
 *  1. Extract all <script src="…"> URLs from the page HTML.
 *  2. For each external JS file (up to 8), request <url>.map directly.
 *  3. Also scan the last 512 bytes of each JS file for a
 *     "//# sourceMappingURL=…" comment pointing to a named map file.
 *  4. Confirm a finding only when the response is valid source-map JSON
 *     (has "sources" array with ≥1 entry, or "sourcesContent" present).
 *
 * Runs on both tiers (only HEAD + small trailer fetches — fast).
 */
import type { ScanVulnerability } from "./scanner.js";
export declare function checkSourceMaps(html: string, baseUrl: string): Promise<ScanVulnerability[]>;
