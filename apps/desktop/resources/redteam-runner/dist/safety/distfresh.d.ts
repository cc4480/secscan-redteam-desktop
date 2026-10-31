/**
 * Dist-freshness guard (safety-relevant, not hygiene).
 *
 * A stale compiled dist/ running against newer src/ is a SILENT safety bug:
 * the llm-router policy switch changed src/policy.ts without rebuilding the
 * git-ignored dist/, and the runner — which imports the compiled dist —
 * kept routing the exploiter to the retired provider until someone rebuilt
 * locally. A stale policy running silently can change WHAT the agents do;
 * that must fail fast, never run.
 *
 * Every engagement start (CLI, UI, watch — all funnel through runEngagement)
 * calls assertDistFresh(), which verifies the runner's own dist/ and the
 * dist/ of the workspace dependencies it imports (llm-router, auth-gate)
 * were built from the current src/. Bypass: REDTEAM_SKIP_DIST_CHECK=1
 * (unit tests only — never set this in operation).
 *
 * The hash MUST stay byte-identical to scripts/dist-hash.mjs (the build-time
 * stamper): sha256 over sorted relative-posix-path + NUL + file bytes + NUL
 * for every regular file under src/.
 */
/**
 * sha256 over every regular file under srcDir.
 * MUST match scripts/dist-hash.mjs hashSrcDir byte-for-byte.
 */
export declare function hashSrcDir(srcDir: string): {
    sha256: string;
    files: number;
};
export interface FreshnessResult {
    fresh: boolean;
    /** Human-readable reason when not fresh. */
    reason?: string;
}
/** Check one workspace dir (must contain src/ and <outputDir>/.src-hash). Never throws for stale state. */
export declare function distIsFresh(workspaceDir: string, label: string, outputDir?: string): FreshnessResult;
/**
 * Walk up from startDir to the workspace root: the nearest ancestor whose
 * package.json carries the given name. Works from dist/safety AND from
 * dist-test/src/safety (the test build mirrors src/ one level deeper).
 */
export declare function findWorkspaceRoot(startDir: string, packageName: string): string | null;
/**
 * Fail fast when the runner's own dist or a workspace dependency's dist is
 * stale. Called at the top of runEngagement — before any target is touched.
 */
export declare function assertDistFresh(): void;
