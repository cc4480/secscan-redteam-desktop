/**
 * Runtime validation and canonical hashing for the memory layer (brief
 * §4/§8). The repo rule is validate at file boundaries: every record read
 * from disk passes through here, and every record is validated again before
 * it is appended. Read-path failures are `STORE_CORRUPT` naming file +
 * line; write-path failures carry the specific §8 code. Nothing invalid is
 * ever written, and nothing invalid on disk is ever silently skipped.
 */
import type { MemoryDiff, MemoryUnit } from './types.js';
export { CLAIM_MAX_CHARS, BODY_MAX_CHARS, L0_MAX_CHARS, L1_MAX_CHARS, sha256OfText, canonicalize, hashRecord, aggregateHashes, normalizeClaim, computeUnitId, computeUnitHash, sealUnit, verifyUnitHash, computeDiffHash, sealDiff, verifyDiffHash } from './schema-hash.js';
/**
 * Structural validation of a memory unit (§4.1/§4.2 field rules). Enforces
 * presence, types, budgets, per-scope-kind required fields, and non-empty
 * provenance. Content binding rules (what may live under which scope) are
 * `assertScopeBinding` in scope.ts; trust derivation is trust.ts. Does NOT
 * verify the self-hash — ledger reads do that in {@link parseUnitLine}.
 *
 * @param raw - The unvalidated value.
 * @param context - Where the record came from, for error messages.
 * @returns The value as a `MemoryUnit`.
 */
export declare function validateUnit(raw: unknown, context: string): MemoryUnit;
/**
 * Parse one `units.jsonl` line (§8 row 3): malformed JSON, an invalid
 * record, an unknown schemaVersion, or a hash mismatch is `STORE_CORRUPT`
 * naming file + line. There is no skip-and-continue on the ledger.
 *
 * @param line - The raw line (without the trailing newline).
 * @param lineNo - 1-based line number, for the error.
 * @param file - The ledger path, for the error.
 * @returns The validated, hash-verified unit.
 */
export declare function parseUnitLine(line: string, lineNo: number, file: string): MemoryUnit;
export declare function validateDiff(raw: unknown, context: string): MemoryDiff;
