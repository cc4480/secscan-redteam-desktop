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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryError } from './errors.js';
import { archiveDirName } from './paths.js';
import { sealDiff, validateDiff, validateUnit, verifyDiffHash } from './schema.js';
import { requireOperator, trustDisagrees } from './apply-rules.js';
import { assertScopeBinding } from './scope.js';
import { openMemoryStore } from './store.js';
import { atomicWriteText } from './views.js';
/**
 * Read and verify a diff from `proposals/`. Missing, malformed, or
 * hash-mismatched diffs are refusals (§7.3) — nothing is written.
 *
 * @param paths - The store paths.
 * @param diffId - The diff to read.
 * @returns The verified diff.
 */
export function readDiff(paths, diffId) {
    const path = join(paths.proposalsDir, `${diffId}.json`);
    if (!existsSync(path)) {
        throw new MemoryError('SCHEMA_INVALID', `memory diff not found: ${diffId} (${path})`);
    }
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(path, 'utf8'));
    }
    catch (err) {
        throw new MemoryError('SCHEMA_INVALID', `memory diff ${diffId} is unparseable`, { cause: err });
    }
    const diff = validateDiff(parsed, `diff ${diffId}`);
    if (!verifyDiffHash(diff)) {
        throw new MemoryError('SCHEMA_INVALID', `memory diff ${diffId}: sha256 does not match its content — the diff was altered after sealing; refusing`);
    }
    return diff;
}
/** Rewrite a diff after a status flip (reject/apply), resealed, in proposals/ and the archive copy. */
function rewriteDiff(paths, diff) {
    const { sha256: _sha256, ...rest } = diff;
    const resealed = sealDiff(rest);
    const bytes = `${JSON.stringify(resealed, null, 2)}\n`;
    atomicWriteText(join(paths.proposalsDir, `${diff.diffId}.json`), bytes);
    const seqPart = diff.diffId.slice(diff.engagementId.length + 1);
    const archiveCopy = join(paths.archivesDir, diff.engagementId, archiveDirName(Number(seqPart)), 'memory_diff.json');
    if (existsSync(archiveCopy))
        atomicWriteText(archiveCopy, bytes);
    return resealed;
}
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
export function approveDiff(paths, diffId, options) {
    const approver = requireOperator(options.operator);
    const diff = readDiff(paths, diffId);
    const proposedIds = diff.proposed.map(op => op.opId);
    const opIds = options.opIds ?? proposedIds;
    for (const opId of opIds) {
        if (!proposedIds.includes(opId)) {
            throw new MemoryError('SCHEMA_INVALID', `approval names op ${opId}, which is not a proposed op of diff ${diffId}`);
        }
    }
    const record = {
        diffId,
        diffSha256: diff.sha256,
        decision: 'approve',
        approver,
        approvedAt: options.nowIso,
        opIds,
        ...(options.note ? { note: options.note } : {}),
    };
    atomicWriteText(join(paths.proposalsDir, `${diffId}.approval.json`), `${JSON.stringify(record, null, 2)}\n`);
    return record;
}
/**
 * Record a named operator's rejection and flip the diff's status to
 * `rejected`. No unit changes, ever (§7.3).
 *
 * @param paths - The store paths.
 * @param diffId - The diff being rejected.
 * @param options - Operator name, optional note, timestamp.
 * @returns The rejection record as written.
 */
export function rejectDiff(paths, diffId, options) {
    const approver = requireOperator(options.operator);
    const diff = readDiff(paths, diffId);
    const record = {
        diffId,
        diffSha256: diff.sha256,
        decision: 'reject',
        approver,
        approvedAt: options.nowIso,
        opIds: [],
        ...(options.note ? { note: options.note } : {}),
    };
    atomicWriteText(join(paths.proposalsDir, `${diffId}.approval.json`), `${JSON.stringify(record, null, 2)}\n`);
    rewriteDiff(paths, { ...diff, status: 'rejected' });
    return record;
}
function readApproval(paths, diffId) {
    const path = join(paths.proposalsDir, `${diffId}.approval.json`);
    if (!existsSync(path)) {
        throw new MemoryError('SCHEMA_INVALID', `no approval record for diff ${diffId} — apply refuses without one`);
    }
    let record;
    try {
        record = JSON.parse(readFileSync(path, 'utf8'));
    }
    catch (err) {
        throw new MemoryError('SCHEMA_INVALID', `approval record for diff ${diffId} is unparseable`, { cause: err });
    }
    if (record.decision !== 'approve') {
        throw new MemoryError('SCHEMA_INVALID', `diff ${diffId} was rejected by ${record.approver} — apply refuses`);
    }
    return record;
}
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
export function applyDiff(paths, diffId, nowIso) {
    const diff = readDiff(paths, diffId);
    const approval = readApproval(paths, diffId);
    if (approval.diffSha256 !== diff.sha256) {
        throw new MemoryError('SCHEMA_INVALID', `approval for diff ${diffId} binds sha256 ${approval.diffSha256}, but the diff now hashes to ${diff.sha256} — refusing`);
    }
    const store = openMemoryStore(paths);
    const receipt = { diffId, applied: [], skipped: [], approver: approval.approver, appliedAt: nowIso };
    const selected = diff.proposed.filter(op => approval.opIds.includes(op.opId));
    store.withLock(() => {
        for (const op of selected) {
            const skip = (reason) => {
                receipt.skipped.push({ opId: op.opId, reason });
            };
            if (op.type === 'retire') {
                const current = store.getUnit(op.unitId);
                if (!current || current.version !== op.baseVersion || current.hash !== op.baseHash) {
                    skip('STALE_BASE');
                    continue;
                }
                store.appendStatus({
                    unitId: op.unitId,
                    version: op.baseVersion,
                    status: 'retired',
                    at: nowIso,
                    by: approval.approver,
                    reason: op.reason,
                    diffId,
                });
                receipt.applied.push({ opId: op.opId, unitId: op.unitId, version: op.baseVersion, beforeHash: current.hash, afterHash: current.hash });
                continue;
            }
            // create / supersede / merge all carry a full unit.
            try {
                validateUnit(op.unit, `apply ${op.opId}`);
                assertScopeBinding(op.unit);
            }
            catch (err) {
                skip(err instanceof MemoryError ? err.code : 'SCHEMA_INVALID');
                continue;
            }
            let overclaim = false;
            try {
                overclaim = trustDisagrees(op);
            }
            catch {
                overclaim = true; // deriveTrust itself threw TRUST_OVERCLAIM
            }
            if (overclaim) {
                skip('TRUST_OVERCLAIM');
                continue;
            }
            if (op.type === 'create') {
                if (store.hasUnit(op.unit.unitId)) {
                    skip('DUPLICATE_NO_CHANGE');
                    continue;
                }
                store.appendUnitVersion(op.unit, { status: 'active', by: approval.approver, reason: 'APPROVED_DIFF_APPLY', diffId, at: nowIso });
                receipt.applied.push({ opId: op.opId, unitId: op.unit.unitId, version: op.unit.version, afterHash: op.unit.hash });
            }
            else if (op.type === 'supersede') {
                const current = store.getUnit(op.unitId);
                if (!current || current.version !== op.baseVersion || current.hash !== op.baseHash) {
                    skip('STALE_BASE');
                    continue;
                }
                if (op.unit.version !== op.baseVersion + 1) {
                    skip('SCHEMA_INVALID');
                    continue;
                }
                store.appendStatus({
                    unitId: op.unitId,
                    version: op.baseVersion,
                    status: 'superseded',
                    at: nowIso,
                    by: approval.approver,
                    reason: 'APPLIED_SUPERSEDE',
                    diffId,
                    successorUnitId: op.unitId,
                });
                store.appendUnitVersion(op.unit, { status: 'active', by: approval.approver, reason: 'APPROVED_DIFF_APPLY', diffId, at: nowIso });
                receipt.applied.push({
                    opId: op.opId,
                    unitId: op.unitId,
                    version: op.unit.version,
                    beforeHash: op.baseHash,
                    afterHash: op.unit.hash,
                });
            }
            else {
                // merge
                if (op.sourceUnitIds.some(id => !store.hasUnit(id))) {
                    skip('STALE_BASE');
                    continue;
                }
                if (store.hasUnit(op.unit.unitId)) {
                    skip('DUPLICATE_NO_CHANGE');
                    continue;
                }
                for (const sourceId of op.sourceUnitIds) {
                    const source = store.getUnit(sourceId);
                    store.appendStatus({
                        unitId: sourceId,
                        version: source.version,
                        status: 'superseded',
                        at: nowIso,
                        by: approval.approver,
                        reason: 'APPLIED_MERGE',
                        diffId,
                        successorUnitId: op.unit.unitId,
                    });
                }
                store.appendUnitVersion(op.unit, { status: 'active', by: approval.approver, reason: 'APPROVED_DIFF_APPLY', diffId, at: nowIso });
                receipt.applied.push({ opId: op.opId, unitId: op.unit.unitId, version: op.unit.version, afterHash: op.unit.hash });
            }
        }
    });
    atomicWriteText(join(paths.proposalsDir, `${diffId}.apply.json`), `${JSON.stringify(receipt, null, 2)}\n`);
    const status = receipt.applied.length === selected.length && selected.length > 0
        ? 'applied'
        : receipt.applied.length > 0
            ? 'partially-applied'
            : diff.status;
    if (status !== diff.status)
        rewriteDiff(paths, { ...diff, status });
    return receipt;
}
//# sourceMappingURL=apply.js.map