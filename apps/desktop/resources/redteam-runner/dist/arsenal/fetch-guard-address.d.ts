/**
 * Address parsing + deny-by-range classification — extracted from
 * `fetch-guard.ts` so the parent module stays inside the runner's 300-line
 * file budget. Pure functions (spec §6.1.3); the parent's public surface is
 * unchanged — these were module-private before the extraction.
 */
export declare function stripBrackets(hostname: string): string;
export interface CheckedAddress {
    family: 4 | 6;
    /** Normalized form handed to the transport as the pinned address. */
    canonical: string;
    blocked: string | null;
}
export declare function parseIpAddress(raw: string): CheckedAddress | null;
