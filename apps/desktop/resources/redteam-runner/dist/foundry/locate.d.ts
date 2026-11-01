/**
 * Foundry location: snapshot discovery, gate CLI location, gate execution.
 *
 * Discovery order (first valid hit wins; every candidate is reported so the
 * console can show exactly where it looked):
 *   1. REDTEAM_FOUNDRY_SNAPSHOT — a snapshot directory named by the operator.
 *   2. A "foundry-snapshot" directory next to the runner payload root.
 *   3. The snapshot bundled inside a locatable @secscan/redteam-foundry-gate
 *      package (payload node_modules, the desktop dsh payload next to the
 *      runner resources, or the monorepo packages tree in a dev checkout).
 *
 * A directory counts as a snapshot only when it holds manifest.json and a
 * bundles/ directory — presence alone is never trusted. The gate CLI is
 * located under the same package roots (lib/types/cli.js). Gate runs spawn
 * node with an argument array only: no shell, and no caller-supplied input —
 * snapshot paths come from discovery and slugs from the manifest.
 */
/** One manifest bundle, projected to the fields the console displays. */
export interface FoundryBundleRow {
    slug: string;
    family: string;
    loopTier: string;
    vulnClass: string;
    cwe: string;
    tier: number | null;
    status: string;
    fitness: number | null;
    panelPassRate: number | null;
}
/** A parsed snapshot manifest, projected for display. */
export interface FoundrySnapshotInfo {
    name: string | null;
    generatedAt: string | null;
    declaredCounts: {
        datasets: number | null;
        gold: number | null;
        silver: number | null;
        liveCases: number | null;
    };
    bundles: FoundryBundleRow[];
    counts: {
        total: number;
        gold: number;
        silver: number;
        other: number;
    };
}
/** One discovery candidate and whether it held a valid snapshot. */
export interface SnapshotCandidate {
    via: string;
    dir: string;
    valid: boolean;
}
/** The outcome of locating the snapshot and the gate CLI. */
export interface FoundryLocation {
    snapshotDir: string | null;
    snapshotVia: string | null;
    snapshotCandidates: SnapshotCandidate[];
    gateCliPath: string | null;
    gatePackageRoots: string[];
}
/**
 * The runner payload root: the package directory that holds dist/ (compiled
 * modules live under dist/foundry, two levels below the root).
 *
 * @returns the absolute payload root path
 */
export declare function runnerPayloadRoot(): string;
/**
 * Candidate roots of the @secscan/redteam-foundry-gate package, in search
 * order: the payload's own node_modules, the desktop dsh payload beside the
 * runner resources dir, then the monorepo packages tree (dev checkouts).
 *
 * @param payloadRoot - the runner payload root
 * @returns the candidate package root paths
 */
export declare function gatePackageRoots(payloadRoot: string): string[];
/** A directory is a snapshot only with a manifest and a bundles/ directory. */
export declare function isSnapshotDir(dir: string): boolean;
/**
 * Locate the Foundry snapshot and gate CLI.
 *
 * @param opts - optional environment and payload-root overrides (tests)
 * @returns the chosen snapshot (or null), every candidate tried, and the
 *   gate CLI path (or null)
 */
export declare function locateFoundry(opts?: {
    env?: NodeJS.ProcessEnv;
    payloadRoot?: string;
}): FoundryLocation;
/**
 * Read and project a snapshot manifest for display.
 *
 * @param snapshotDir - a directory already validated as a snapshot
 * @returns the projected manifest, or null when it cannot be parsed
 */
export declare function readSnapshot(snapshotDir: string): FoundrySnapshotInfo | null;
