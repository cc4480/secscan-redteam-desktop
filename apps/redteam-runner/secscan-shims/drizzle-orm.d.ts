/**
 * Compile-time surface for the embedded drizzle-orm runtime shim
 * (secscan-vendor/drizzle-orm). The vendored engine imports exactly one
 * symbol, `eq`, and passes the result into the (stubbed) db chain, where
 * it is never interpreted. The shim returns an opaque placeholder.
 */
export declare function eq(...args: unknown[]): unknown;
