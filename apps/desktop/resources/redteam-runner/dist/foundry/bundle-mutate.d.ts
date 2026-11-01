/**
 * Evolution — operators-v1, bundle surface (reference: evolution.py).
 *
 * Deterministic, label-preserving transforms over a snapshot bundle's
 * files. Every operator verifies its anchors and FAILS LOUD on a miss.
 * The naive-filter operator inserts a per-class naive blacklist
 * IDENTICALLY into both twins (twin integrity preserved) and upgrades
 * the probe to the bypassing payload.
 */
import { type OpOutcome, type Operator } from './mutate.js';
/** Files of one bundle, keyed by relative path. */
export type BundleFiles = Map<string, string>;
/** Short operator codes used in mutant slugs. */
export declare const OPERATOR_CODES: Record<Operator, string>;
/**
 * Apply one operator to a snapshot bundle's files (in memory).
 *
 * @param files - the seed bundle's files (not mutated; a copy is returned)
 * @param operator - the operator to apply
 * @param seedSlug - the seed bundle slug
 * @param cycle - the loop cycle number
 * @returns the mutant files + chosen anchors, or the loud failure
 */
export declare function applyBundleOperator(files: BundleFiles, operator: Operator, seedSlug: string, cycle: number): OpOutcome<{
    files: BundleFiles;
    detail: string;
}>;
/**
 * Recompute a bundle directory's hash, byte-for-byte compatible with the
 * Foundry validator (sorted relative paths; path bytes then file bytes) —
 * the same algorithm as @secscan/redteam-foundry-gate's bundleHash.
 *
 * @param files - the bundle's files by relative path (contents as strings)
 * @returns the lowercase hex SHA-256 digest
 */
export declare function bundleHashOfFiles(files: BundleFiles): string;
