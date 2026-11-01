/**
 * Runtime validation and canonical hashing for the memory layer (brief
 * §4/§8). The repo rule is validate at file boundaries: every record read
 * from disk passes through here, and every record is validated again before
 * it is appended. Read-path failures are `STORE_CORRUPT` naming file +
 * line; write-path failures carry the specific §8 code. Nothing invalid is
 * ever written, and nothing invalid on disk is ever silently skipped.
 */
import type { MemoryDiff, MemoryUnit } from "./types.js";
/** §4.1 field budgets. */
export declare const CLAIM_MAX_CHARS = 2000;
export declare const BODY_MAX_CHARS = 20000;
export declare const L0_MAX_CHARS = 256;
export declare const L1_MAX_CHARS = 4000;
/** sha256 hex of a UTF-8 string. */
export declare function sha256OfText(text: string): string;
/**
 * Canonical JSON: object keys sorted recursively, arrays in order, no
 * whitespace — the byte form every hash in this module is computed over.
 * Mirrors `JSON.stringify` semantics for `undefined` (dropped from objects,
 * `null` in arrays). Non-finite numbers have no canonical form and throw.
 *
 * @param value - Any JSON-shaped value.
 * @returns The canonical string.
 */
export declare function canonicalize(value: unknown): string;
/** sha256 hex over the canonical form of a record. */
export declare function hashRecord(value: unknown): string;
/**
 * The views/index aggregate (§5.3): sha256 over the sorted unit hashes a
 * directory covers, so an index that disagrees with the ledger is
 * detectable at open.
 *
 * @param hashes - The current-version unit hashes in one directory.
 * @returns The aggregate hash (of the empty string for an empty set).
 */
export declare function aggregateHashes(hashes: readonly string[]): string;
/** Claim normalization for the deterministic unitId (§4.1 dedupe). */
export declare function normalizeClaim(claim: string): string;
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
export declare function computeUnitId(scopeKey: string, kind: string, claim: string, primarySourceRefUri: string): string;
/** sha256 over the canonical unit record excluding the `hash` field itself. */
export declare function computeUnitHash(unit: MemoryUnit): string;
/** Return the unit with its `hash` field computed and set. */
export declare function sealUnit(unit: Omit<MemoryUnit, "hash">): MemoryUnit;
/** True when the unit's `hash` matches its canonical record. */
export declare function verifyUnitHash(unit: MemoryUnit): boolean;
/** sha256 over the canonical diff excluding the `sha256` field (§7.2). */
export declare function computeDiffHash(diff: MemoryDiff): string;
/** Return the diff with its `sha256` field computed and set. */
export declare function sealDiff(diff: Omit<MemoryDiff, "sha256">): MemoryDiff;
/** True when the diff's `sha256` matches its canonical content. */
export declare function verifyDiffHash(diff: MemoryDiff): boolean;
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
