/**
 * Memory hashing primitives — extracted from schema.ts to keep the validator
 * module under the 300-line budget. Pure: canonicalisation and the §4.1 field
 * budgets, with no I/O and no store access.
 */
import { createHash } from 'node:crypto';
import { MemoryError } from './errors.js';
export const CLAIM_MAX_CHARS = 2000;
export const BODY_MAX_CHARS = 20000;
export const L0_MAX_CHARS = 256;
export const L1_MAX_CHARS = 4000;
export const UNIT_KINDS = new Set([
    'finding',
    'killed-hypothesis',
    'trajectory-lesson',
    'target-fact',
    'experience-lesson',
    'operator-note',
    'target-derived-claim',
]);
export const SOURCE_CLASSES = new Set([
    'proof-bundle',
    'registry',
    'trajectory',
    'experience',
    'operator',
    'target-content',
    'model-inference',
]);
export const PROOF_STATES = new Set(['proven', 'confirmed', 'killed', 'deferred', 'unproven']);
export const TRUST_TIERS = new Set(['proven', 'confirmed', 'killed', 'corroborated', 'single-source', 'untrusted-target']);
export const HEX64 = /^[0-9a-f]{64}$/;
/** sha256 hex of a UTF-8 string. */
export function sha256OfText(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}
/**
 * Canonical JSON: object keys sorted recursively, arrays in order, no
 * whitespace — the byte form every hash in this module is computed over.
 * Mirrors `JSON.stringify` semantics for `undefined` (dropped from objects,
 * `null` in arrays). Non-finite numbers have no canonical form and throw.
 *
 * @param value - Any JSON-shaped value.
 * @returns The canonical string.
 */
export function canonicalize(value) {
    if (value === null)
        return 'null';
    if (typeof value === 'boolean')
        return value ? 'true' : 'false';
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new MemoryError('SCHEMA_INVALID', 'canonicalize: non-finite number');
        return JSON.stringify(value);
    }
    if (typeof value === 'string')
        return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map(item => (item === undefined ? 'null' : canonicalize(item))).join(',')}]`;
    }
    if (typeof value === 'object') {
        const record = value;
        const keys = Object.keys(record)
            .filter(key => record[key] !== undefined)
            .sort();
        return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
    }
    throw new MemoryError('SCHEMA_INVALID', `canonicalize: unsupported value type ${typeof value}`);
}
/** sha256 hex over the canonical form of a record. */
export function hashRecord(value) {
    return sha256OfText(canonicalize(value));
}
/**
 * The views/index aggregate (§5.3): sha256 over the sorted unit hashes a
 * directory covers, so an index that disagrees with the ledger is
 * detectable at open.
 *
 * @param hashes - The current-version unit hashes in one directory.
 * @returns The aggregate hash (of the empty string for an empty set).
 */
export function aggregateHashes(hashes) {
    return sha256OfText([...hashes].sort().join('\n'));
}
/** Claim normalization for the deterministic unitId (§4.1 dedupe). */
export function normalizeClaim(claim) {
    return claim.trim().replace(/\s+/g, ' ').toLowerCase();
}
/**
 * The deterministic unitId (§4.1): the same claim, from the same scope and
 * primary source, projected twice resolves to the same id and becomes a
 * corroboration/version event instead of a duplicate unit.
 *
 * @param scopeKey - The unit's scopeKey.
 * @param kind - The unit kind.
 * @param claim - The unit's claim (normalized before hashing).
 * @param primarySourceRefUri - The primary source ref's URI.
 * @returns `mem_` + 24 hex chars.
 */
export function computeUnitId(scopeKey, kind, claim, primarySourceRefUri) {
    const claimHash = sha256OfText(normalizeClaim(claim));
    return `mem_${sha256OfText([scopeKey, kind, claimHash, primarySourceRefUri].join('‖')).slice(0, 24)}`;
}
/** sha256 over the canonical unit record excluding the `hash` field itself. */
export function computeUnitHash(unit) {
    const { hash: _hash, ...rest } = unit;
    return hashRecord(rest);
}
/** Return the unit with its `hash` field computed and set. */
export function sealUnit(unit) {
    const draft = { ...unit, hash: '' };
    return { ...draft, hash: computeUnitHash(draft) };
}
/** True when the unit's `hash` matches its canonical record. */
export function verifyUnitHash(unit) {
    return HEX64.test(unit.hash) && computeUnitHash(unit) === unit.hash;
}
/** sha256 over the canonical diff excluding the `sha256` field (§7.2). */
export function computeDiffHash(diff) {
    const { sha256: _sha256, ...rest } = diff;
    return hashRecord(rest);
}
/** Return the diff with its `sha256` field computed and set. */
export function sealDiff(diff) {
    const draft = { ...diff, sha256: '' };
    return { ...draft, sha256: computeDiffHash(draft) };
}
/** True when the diff's `sha256` matches its canonical content. */
export function verifyDiffHash(diff) {
    return HEX64.test(diff.sha256) && computeDiffHash(diff) === diff.sha256;
}
// ---------------------------------------------------------------------------
// Validation helpers — every failure is a MemoryError naming the field.
// ---------------------------------------------------------------------------
//# sourceMappingURL=schema-hash.js.map