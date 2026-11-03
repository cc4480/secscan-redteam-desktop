/**
 * Runtime validation and canonical hashing for the memory layer (brief
 * §4/§8). The repo rule is validate at file boundaries: every record read
 * from disk passes through here, and every record is validated again before
 * it is appended. Read-path failures are `STORE_CORRUPT` naming file +
 * line; write-path failures carry the specific §8 code. Nothing invalid is
 * ever written, and nothing invalid on disk is ever silently skipped.
 */

import { MemoryError } from "./errors.js";
import type { MemoryDiff, MemoryUnit } from "./types.js";

export { CLAIM_MAX_CHARS, BODY_MAX_CHARS, L0_MAX_CHARS, L1_MAX_CHARS, sha256OfText, canonicalize, hashRecord, aggregateHashes, normalizeClaim, computeUnitId, computeUnitHash, sealUnit, verifyUnitHash, computeDiffHash, sealDiff, verifyDiffHash } from "./schema-hash.js";
import { CLAIM_MAX_CHARS, BODY_MAX_CHARS, L0_MAX_CHARS, L1_MAX_CHARS, UNIT_KINDS, SOURCE_CLASSES, PROOF_STATES, TRUST_TIERS, HEX64, verifyUnitHash } from "./schema-hash.js";
/** §4.1 field budgets. */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function fail(context: string, detail: string): never {
  throw new MemoryError("SCHEMA_INVALID", `${context}: ${detail}`);
}

function reqString(rec: Record<string, unknown>, field: string, context: string): string {
  const value = rec[field];
  if (typeof value !== "string" || value.length === 0) fail(context, `field "${field}" must be a non-empty string`);
  return value as string;
}

function reqStringArray(rec: Record<string, unknown>, field: string, context: string): string[] {
  const value = rec[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    fail(context, `field "${field}" must be an array of strings`);
  }
  return value as string[];
}

function reqIso(rec: Record<string, unknown>, field: string, context: string): void {
  const value = reqString(rec, field, context);
  if (!Number.isFinite(Date.parse(value))) fail(context, `field "${field}" must be an ISO timestamp`);
}

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
export function validateUnit(raw: unknown, context: string): MemoryUnit {
  const rec = asRecord(raw);
  if (!rec) fail(context, "unit must be a JSON object");
  if (rec.schemaVersion !== 1) fail(context, `unsupported schemaVersion ${JSON.stringify(rec.schemaVersion)}`);
  const unitId = reqString(rec, "unitId", context);
  if (!/^mem_[0-9a-f]{24}$/.test(unitId)) fail(context, `unitId "${unitId}" is malformed`);
  if (!Number.isInteger(rec.version) || (rec.version as number) < 1) fail(context, "version must be an integer >= 1");
  if (!UNIT_KINDS.has(rec.kind as string)) fail(context, `unknown kind ${JSON.stringify(rec.kind)}`);
  const claim = reqString(rec, "claim", context);
  if (claim.length > CLAIM_MAX_CHARS) fail(context, `claim exceeds ${CLAIM_MAX_CHARS} chars`);
  if (typeof rec.body !== "string" || rec.body.length > BODY_MAX_CHARS) {
    fail(context, `body must be a string of at most ${BODY_MAX_CHARS} chars`);
  }
  // Scope — REQUIRED, no default, no unit exists without it (§4.2).
  const scope = asRecord(rec.scope);
  if (!scope) fail(context, "scope is required — a unit never exists without one");
  if (!["engagement-target", "target-class", "global-procedural"].includes(scope.kind as string)) {
    fail(context, `unknown scope kind ${JSON.stringify(scope.kind)}`);
  }
  reqString(scope, "scopeKey", context);
  const hosts = reqStringArray(scope, "hosts", context);
  if (scope.kind === "engagement-target" && hosts.length === 0) {
    fail(context, "engagement-target scope requires non-empty hosts");
  }
  if (scope.kind === "target-class") reqString(scope, "targetClass", context);
  reqStringArray(scope, "stack", context);
  reqStringArray(scope, "originEngagementIds", context);
  // Provenance — at least one source ref; empty provenance is an error.
  const provenance = asRecord(rec.provenance);
  if (!provenance) fail(context, "provenance is required");
  if (!SOURCE_CLASSES.has(provenance.sourceClass as string)) {
    fail(context, `unknown sourceClass ${JSON.stringify(provenance.sourceClass)}`);
  }
  if (!Array.isArray(provenance.sourceRefs) || provenance.sourceRefs.length === 0) {
    throw new MemoryError("MISSING_PROVENANCE", `${context}: provenance.sourceRefs must be non-empty`);
  }
  for (const ref of provenance.sourceRefs) {
    const refRec = asRecord(ref);
    if (!refRec) fail(context, "provenance.sourceRefs entries must be objects");
    reqString(refRec, "kind", context);
    reqString(refRec, "uri", context);
  }
  reqStringArray(provenance, "derivedFromUnitIds", context);
  const extractor = asRecord(provenance.extractor);
  if (!extractor) fail(context, "provenance.extractor is required");
  reqString(extractor, "name", context);
  reqString(extractor, "version", context);
  reqString(extractor, "inputHash", context);
  reqIso(provenance, "createdAt", context);
  reqString(provenance, "createdBy", context);
  // Proof — receipts are REQUIRED non-empty for proven/confirmed (§4.3):
  // asserting either state without a receipt is an overclaim, not a unit.
  const proof = asRecord(rec.proof);
  if (!proof) fail(context, "proof is required");
  if (!PROOF_STATES.has(proof.state as string)) fail(context, `unknown proof state ${JSON.stringify(proof.state)}`);
  if (!Array.isArray(proof.receipts)) fail(context, "proof.receipts must be an array");
  if ((proof.state === "proven" || proof.state === "confirmed") && proof.receipts.length === 0) {
    throw new MemoryError(
      "TRUST_OVERCLAIM",
      `${context}: proof.state "${proof.state as string}" asserted without any receipt`,
    );
  }
  if (proof.cellState === "proven" && typeof proof.negativeControlReceiptRef !== "string") {
    throw new MemoryError(
      "TRUST_OVERCLAIM",
      `${context}: cellState "proven" without a negativeControlReceiptRef`,
    );
  }
  // Trust block — shape only; the values are derivation's business (trust.ts).
  const trust = asRecord(rec.trust);
  if (!trust) fail(context, "trust is required");
  if (!TRUST_TIERS.has(trust.tier as string)) fail(context, `unknown trust tier ${JSON.stringify(trust.tier)}`);
  if (typeof trust.baseScore !== "number" || trust.baseScore < 0 || trust.baseScore > 1) {
    fail(context, "trust.baseScore must be a number in 0..1");
  }
  reqStringArray(trust, "derivation", context);
  reqIso(trust, "derivedAt", context);
  const corroboration = asRecord(rec.corroboration);
  if (!corroboration) fail(context, "corroboration is required");
  if (!Number.isInteger(corroboration.independentCount) || (corroboration.independentCount as number) < 0) {
    fail(context, "corroboration.independentCount must be an integer >= 0");
  }
  reqStringArray(corroboration, "sourceKeys", context);
  if (rec.contentClass !== "normal" && rec.contentClass !== "target-derived-untrusted") {
    fail(context, `unknown contentClass ${JSON.stringify(rec.contentClass)}`);
  }
  reqStringArray(rec, "tags", context);
  reqStringArray(rec, "attackIds", context);
  reqStringArray(rec, "stack", context);
  const views = asRecord(rec.views);
  if (!views) fail(context, "views is required");
  if (typeof views.l0 !== "string" || views.l0.length > L0_MAX_CHARS) fail(context, `views.l0 exceeds ${L0_MAX_CHARS} chars`);
  if (typeof views.l1 !== "string" || views.l1.length > L1_MAX_CHARS) fail(context, `views.l1 exceeds ${L1_MAX_CHARS} chars`);
  if (typeof views.sourceHash !== "string" || !HEX64.test(views.sourceHash)) fail(context, "views.sourceHash must be sha256 hex");
  reqString(views, "generator", context);
  reqIso(views, "generatedAt", context);
  if (!HEX64.test(rec.hash as string)) fail(context, "hash must be sha256 hex");
  return raw as MemoryUnit;
}

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
export function parseUnitLine(line: string, lineNo: number, file: string): MemoryUnit {
  const where = `${file}:${lineNo}`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    throw new MemoryError("STORE_CORRUPT", `${where}: invalid JSON`, { cause: err });
  }
  let unit: MemoryUnit;
  try {
    unit = validateUnit(parsed, where);
  } catch (err) {
    throw new MemoryError("STORE_CORRUPT", `${where}: invalid unit record`, { cause: err });
  }
  if (!verifyUnitHash(unit)) {
    throw new MemoryError("STORE_CORRUPT", `${where}: unit hash mismatch (record was altered after sealing)`);
  }
  return unit;
}

/**
 * Structural validation of a memory diff (§7.2) read from disk: required
 * fields present, counts consistent with the op lists, status known. The
 * sha256 binding itself is checked by approve/apply via {@link verifyDiffHash}.
 *
 * @param raw - The unvalidated value.
 * @param context - Where the record came from, for error messages.
 * @returns The value as a `MemoryDiff`.
 */
/**
 * Validate one diff op structurally. The v1 op set is closed: a `delete`
 * op (or any unknown type) is refused by name — there is NO delete op in
 * v1 (§7.2), and a diff carrying one must never reach apply.
 *
 * @param raw - The unvalidated op.
 * @param context - Where the op came from, for error messages.
 */
function validateDiffOp(raw: unknown, context: string): void {
  const op = asRecord(raw);
  if (!op) fail(context, "diff op must be an object");
  reqString(op, "opId", context);
  if (op.type === "delete") {
    fail(context, "DELETE_NOT_SUPPORTED_V1: diffs carry no delete op in v1");
  }
  if (op.type === "create") {
    validateUnit(op.unit, `${context} unit`);
    return;
  }
  if (op.type === "supersede") {
    reqString(op, "unitId", context);
    if (!Number.isInteger(op.baseVersion) || (op.baseVersion as number) < 1) fail(context, "supersede baseVersion must be a positive integer");
    if (!HEX64.test(op.baseHash as string)) fail(context, "supersede baseHash must be sha256 hex");
    validateUnit(op.unit, `${context} unit`);
    return;
  }
  if (op.type === "merge") {
    if (!Array.isArray(op.sourceUnitIds) || op.sourceUnitIds.length === 0 || op.sourceUnitIds.some((id) => typeof id !== "string")) {
      fail(context, "merge sourceUnitIds must be a non-empty string array");
    }
    validateUnit(op.unit, `${context} unit`);
    return;
  }
  if (op.type === "retire") {
    reqString(op, "unitId", context);
    if (!Number.isInteger(op.baseVersion) || (op.baseVersion as number) < 1) fail(context, "retire baseVersion must be a positive integer");
    if (!HEX64.test(op.baseHash as string)) fail(context, "retire baseHash must be sha256 hex");
    reqString(op, "reason", context);
    return;
  }
  fail(context, `unknown diff op type ${JSON.stringify(op.type)}`);
}

export function validateDiff(raw: unknown, context: string): MemoryDiff {
  const rec = asRecord(raw);
  if (!rec) fail(context, "diff must be a JSON object");
  reqString(rec, "diffId", context);
  reqString(rec, "engagementId", context);
  reqString(rec, "archiveUri", context);
  reqIso(rec, "createdAt", context);
  if (!asRecord(rec.inputHashes)) fail(context, "inputHashes is required");
  if (!Array.isArray(rec.autoApplied) || !Array.isArray(rec.proposed) || !Array.isArray(rec.skipped)) {
    fail(context, "autoApplied/proposed/skipped must be arrays");
  }
  for (const [i, op] of (rec.autoApplied as unknown[]).entries()) validateDiffOp(op, `${context} autoApplied[${i}]`);
  for (const [i, op] of (rec.proposed as unknown[]).entries()) validateDiffOp(op, `${context} proposed[${i}]`);
  const counts = asRecord(rec.counts);
  if (!counts) fail(context, "counts is required");
  if (
    counts.autoApplied !== rec.autoApplied.length ||
    counts.proposed !== rec.proposed.length ||
    counts.skipped !== rec.skipped.length
  ) {
    fail(context, "counts disagree with the op lists");
  }
  if (!["proposed", "applied", "partially-applied", "rejected", "failed"].includes(rec.status as string)) {
    fail(context, `unknown diff status ${JSON.stringify(rec.status)}`);
  }
  if (!HEX64.test(rec.sha256 as string)) fail(context, "sha256 must be sha256 hex");
  return raw as MemoryDiff;
}
