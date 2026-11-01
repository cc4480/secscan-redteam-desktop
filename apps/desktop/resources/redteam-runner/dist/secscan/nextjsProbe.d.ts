/**
 * Next.js-specific security probe.
 *
 * Checks for:
 * 1. Source map exposure via /_next/static chunks — leaks full application source.
 * 2. Build ID disclosure — fingerprints exact deployment version.
 * 3. Environment variable leakage via NEXT_PUBLIC_ prefix patterns in JS bundles.
 * 4. Debug/telemetry routes left enabled in production.
 */
import type { ScanVulnerability } from "./scanner.js";
export declare function runNextjsProbe(baseUrl: string, html: string, rawHeaders?: Record<string, string>): Promise<ScanVulnerability[]>;
