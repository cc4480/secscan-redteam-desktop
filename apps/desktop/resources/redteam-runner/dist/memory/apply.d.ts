/**
 * Approval and apply (brief §7.3): the only code path that activates
 * proposed semantic ops, and it belongs to a NAMED HUMAN OPERATOR — the
 * fleet cannot approve its own memory. Approval is recorded BEFORE
 * anything applies and binds to the diff's sha256: approving bytes you
 * never saw is refused. Apply re-verifies the binding, revalidates every
 * selected op against the current store (a stale base is skipped as
 * `STALE_BASE`, never force-applied), and re-runs trust derivation — an
 * op whose stored trust block disagrees with derivation is skipped as
 * `TRUST_OVERCLAIM` even if approved. Approval authorizes persistence;
 * it does not mint proof.
 */
import type { MemoryPaths } from "./paths.js";
import type { MemoryApprovalRecord, MemoryApplyReceipt, MemoryDiff } from "./types.js";
/**
 * Read and verify a diff from `proposals/`. Missing, malformed, or
 * hash-mismatched diffs are refusals (§7.3) — nothing is written.
 *
 * @param paths - The store paths.
 * @param diffId - The diff to read.
 * @returns The verified diff.
 */
export declare function readDiff(paths: MemoryPaths, diffId: string): MemoryDiff;
/**
 * Record a named operator's approval of a diff (all proposed ops, or the
 * `--ops` subset). Writes `proposals/<diffId>.approval.json`; applies
 * nothing.
 *
 * @param paths - The store paths.
 * @param diffId - The diff being approved.
 * @param options - Approver name, optional op subset, note, timestamp.
 * @returns The approval record as written.
 */
export declare function approveDiff(paths: MemoryPaths, diffId: string, options: {
    operator: string;
    opIds?: string[];
    note?: string;
    nowIso: string;
}): MemoryApprovalRecord;
/**
 * Record a named operator's rejection and flip the diff's status to
 * `rejected`. No unit changes, ever (§7.3).
 *
 * @param paths - The store paths.
 * @param diffId - The diff being rejected.
 * @param options - Operator name, optional note, timestamp.
 * @returns The rejection record as written.
 */
export declare function rejectDiff(paths: MemoryPaths, diffId: string, options: {
    operator: string;
    note?: string;
    nowIso: string;
}): MemoryApprovalRecord;
/**
 * Apply an approved diff: re-verify the approval's hash binding, then
 * under the store lock revalidate and append each selected op. Skips are
 * recorded in the apply receipt with their reason — visible, never
 * silent, never force-applied.
 *
 * @param paths - The store paths.
 * @param diffId - The approved diff.
 * @param nowIso - Timestamp for the apply.
 * @returns The apply receipt (also written to `proposals/<diffId>.apply.json`).
 */
export declare function applyDiff(paths: MemoryPaths, diffId: string, nowIso: string): MemoryApplyReceipt;
