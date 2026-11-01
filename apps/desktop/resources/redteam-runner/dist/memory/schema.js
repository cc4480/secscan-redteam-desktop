/**
 * Runtime validation and canonical hashing for the memory layer (brief
 * §4/§8). The repo rule is validate at file boundaries: every record read
 * from disk passes through here, and every record is validated again before
 * it is appended. Read-path failures are `STORE_CORRUPT` naming file +
 * line; write-path failures carry the specific §8 code. Nothing invalid is
 * ever written, and nothing invalid on disk is ever silently skipped.
 */
import { createHash } from "node:crypto";
import { MemoryError } from "./errors.js";
/** §4.1 field budgets. */
export const CLAIM_MAX_CHARS = 2000;
export const BODY_MAX_CHARS = 20000;
export const L0_MAX_CHARS = 256;
export const L1_MAX_CHARS = 4000;
const UNIT_KINDS = new Set([
    "finding",
    "killed-hypothesis",
    "trajectory-lesson",
    "target-fact",
    "experience-lesson",
    "operator-note",
    "target-derived-claim",
]);
const SOURCE_CLASSES = new Set([
    "proof-bundle",
    "registry",
    "trajectory",
    "experience",
    "operator",
    "target-content",
    "model-inference",
]);
const PROOF_STATES = new Set(["proven", "confirmed", "killed", "deferred", "unproven"]);
const TRUST_TIERS = new Set(["proven", "confirmed", "killed", "corroborated", "single-source", "untrusted-target"]);
const HEX64 = /^[0-9a-f]{64}$/;
/** sha256 hex of a UTF-8 string. */
export function sha256OfText(text) {
    return createHash("sha256").update(text, "utf8").digest("hex");
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
        return "null";
    if (typeof value === "boolean")
        return value ? "true" : "false";
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new MemoryError("SCHEMA_INVALID", "canonicalize: non-finite number");
        return JSON.stringify(value);
    }
    if (typeof value === "string")
        return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map((item) => (item === undefined ? "null" : canonicalize(item))).join(",")}]`;
    }
    if (typeof value === "object") {
        const record = value;
        const keys = Object.keys(record)
            .filter((key) => record[key] !== undefined)
            .sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
    }
    throw new MemoryError("SCHEMA_INVALID", `canonicalize: unsupported value type ${typeof value}`);
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
    return sha256OfText([...hashes].sort().join("\n"));
}
/** Claim normalization for the deterministic unitId (§4.1 dedupe). */
export function normalizeClaim(claim) {
    return claim.trim().replace(/\s+/g, " ").toLowerCase();
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
    return `mem_${sha256OfText([scopeKey, kind, claimHash, primarySourceRefUri].join("‖")).slice(0, 24)}`;
}
/** sha256 over the canonical unit record excluding the `hash` field itself. */
export function computeUnitHash(unit) {
    const { hash: _hash, ...rest } = unit;
    return hashRecord(rest);
}
/** Return the unit with its `hash` field computed and set. */
export function sealUnit(unit) {
    const draft = { ...unit, hash: "" };
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
    const draft = { ...diff, sha256: "" };
    return { ...draft, sha256: computeDiffHash(draft) };
}
/** True when the diff's `sha256` matches its canonical content. */
export function verifyDiffHash(diff) {
    return HEX64.test(diff.sha256) && computeDiffHash(diff) === diff.sha256;
}
// ---------------------------------------------------------------------------
// Validation helpers — every failure is a MemoryError naming the field.
// ---------------------------------------------------------------------------
function asRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value
        : null;
}
function fail(context, detail) {
    throw new MemoryError("SCHEMA_INVALID", `${context}: ${detail}`);
}
function reqString(rec, field, context) {
    const value = rec[field];
    if (typeof value !== "string" || value.length === 0)
        fail(context, `field "${field}" must be a non-empty string`);
    return value;
}
function reqStringArray(rec, field, context) {
    const value = rec[field];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        fail(context, `field "${field}" must be an array of strings`);
    }
    return value;
}
function reqIso(rec, field, context) {
    const value = reqString(rec, field, context);
    if (!Number.isFinite(Date.parse(value)))
        fail(context, `field "${field}" must be an ISO timestamp`);
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
export function validateUnit(raw, context) {
    const rec = asRecord(raw);
    if (!rec)
        fail(context, "unit must be a JSON object");
    if (rec.schemaVersion !== 1)
        fail(context, `unsupported schemaVersion ${JSON.stringify(rec.schemaVersion)}`);
    const unitId = reqString(rec, "unitId", context);
    if (!/^mem_[0-9a-f]{24}$/.test(unitId))
        fail(context, `unitId "${unitId}" is malformed`);
    if (!Number.isInteger(rec.version) || rec.version < 1)
        fail(context, "version must be an integer >= 1");
    if (!UNIT_KINDS.has(rec.kind))
        fail(context, `unknown kind ${JSON.stringify(rec.kind)}`);
    const claim = reqString(rec, "claim", context);
    if (claim.length > CLAIM_MAX_CHARS)
        fail(context, `claim exceeds ${CLAIM_MAX_CHARS} chars`);
    if (typeof rec.body !== "string" || rec.body.length > BODY_MAX_CHARS) {
        fail(context, `body must be a string of at most ${BODY_MAX_CHARS} chars`);
    }
    // Scope — REQUIRED, no default, no unit exists without it (§4.2).
    const scope = asRecord(rec.scope);
    if (!scope)
        fail(context, "scope is required — a unit never exists without one");
    if (!["engagement-target", "target-class", "global-procedural"].includes(scope.kind)) {
        fail(context, `unknown scope kind ${JSON.stringify(scope.kind)}`);
    }
    reqString(scope, "scopeKey", context);
    const hosts = reqStringArray(scope, "hosts", context);
    if (scope.kind === "engagement-target" && hosts.length === 0) {
        fail(context, "engagement-target scope requires non-empty hosts");
    }
    if (scope.kind === "target-class")
        reqString(scope, "targetClass", context);
    reqStringArray(scope, "stack", context);
    reqStringArray(scope, "originEngagementIds", context);
    // Provenance — at least one source ref; empty provenance is an error.
    const provenance = asRecord(rec.provenance);
    if (!provenance)
        fail(context, "provenance is required");
    if (!SOURCE_CLASSES.has(provenance.sourceClass)) {
        fail(context, `unknown sourceClass ${JSON.stringify(provenance.sourceClass)}`);
    }
    if (!Array.isArray(provenance.sourceRefs) || provenance.sourceRefs.length === 0) {
        throw new MemoryError("MISSING_PROVENANCE", `${context}: provenance.sourceRefs must be non-empty`);
    }
    for (const ref of provenance.sourceRefs) {
        const refRec = asRecord(ref);
        if (!refRec)
            fail(context, "provenance.sourceRefs entries must be objects");
        reqString(refRec, "kind", context);
        reqString(refRec, "uri", context);
    }
    reqStringArray(provenance, "derivedFromUnitIds", context);
    const extractor = asRecord(provenance.extractor);
    if (!extractor)
        fail(context, "provenance.extractor is required");
    reqString(extractor, "name", context);
    reqString(extractor, "version", context);
    reqString(extractor, "inputHash", context);
    reqIso(provenance, "createdAt", context);
    reqString(provenance, "createdBy", context);
    // Proof — receipts are REQUIRED non-empty for proven/confirmed (§4.3):
    // asserting either state without a receipt is an overclaim, not a unit.
    const proof = asRecord(rec.proof);
    if (!proof)
        fail(context, "proof is required");
    if (!PROOF_STATES.has(proof.state))
        fail(context, `unknown proof state ${JSON.stringify(proof.state)}`);
    if (!Array.isArray(proof.receipts))
        fail(context, "proof.receipts must be an array");
    if ((proof.state === "proven" || proof.state === "confirmed") && proof.receipts.length === 0) {
        throw new MemoryError("TRUST_OVERCLAIM", `${context}: proof.state "${proof.state}" asserted without any receipt`);
    }
    if (proof.cellState === "proven" && typeof proof.negativeControlReceiptRef !== "string") {
        throw new MemoryError("TRUST_OVERCLAIM", `${context}: cellState "proven" without a negativeControlReceiptRef`);
    }
    // Trust block — shape only; the values are derivation's business (trust.ts).
    const trust = asRecord(rec.trust);
    if (!trust)
        fail(context, "trust is required");
    if (!TRUST_TIERS.has(trust.tier))
        fail(context, `unknown trust tier ${JSON.stringify(trust.tier)}`);
    if (typeof trust.baseScore !== "number" || trust.baseScore < 0 || trust.baseScore > 1) {
        fail(context, "trust.baseScore must be a number in 0..1");
    }
    reqStringArray(trust, "derivation", context);
    reqIso(trust, "derivedAt", context);
    const corroboration = asRecord(rec.corroboration);
    if (!corroboration)
        fail(context, "corroboration is required");
    if (!Number.isInteger(corroboration.independentCount) || corroboration.independentCount < 0) {
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
    if (!views)
        fail(context, "views is required");
    if (typeof views.l0 !== "string" || views.l0.length > L0_MAX_CHARS)
        fail(context, `views.l0 exceeds ${L0_MAX_CHARS} chars`);
    if (typeof views.l1 !== "string" || views.l1.length > L1_MAX_CHARS)
        fail(context, `views.l1 exceeds ${L1_MAX_CHARS} chars`);
    if (typeof views.sourceHash !== "string" || !HEX64.test(views.sourceHash))
        fail(context, "views.sourceHash must be sha256 hex");
    reqString(views, "generator", context);
    reqIso(views, "generatedAt", context);
    if (!HEX64.test(rec.hash))
        fail(context, "hash must be sha256 hex");
    return raw;
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
export function parseUnitLine(line, lineNo, file) {
    const where = `${file}:${lineNo}`;
    let parsed;
    try {
        parsed = JSON.parse(line);
    }
    catch (err) {
        throw new MemoryError("STORE_CORRUPT", `${where}: invalid JSON`, { cause: err });
    }
    let unit;
    try {
        unit = validateUnit(parsed, where);
    }
    catch (err) {
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
function validateDiffOp(raw, context) {
    const op = asRecord(raw);
    if (!op)
        fail(context, "diff op must be an object");
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
        if (!Number.isInteger(op.baseVersion) || op.baseVersion < 1)
            fail(context, "supersede baseVersion must be a positive integer");
        if (!HEX64.test(op.baseHash))
            fail(context, "supersede baseHash must be sha256 hex");
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
        if (!Number.isInteger(op.baseVersion) || op.baseVersion < 1)
            fail(context, "retire baseVersion must be a positive integer");
        if (!HEX64.test(op.baseHash))
            fail(context, "retire baseHash must be sha256 hex");
        reqString(op, "reason", context);
        return;
    }
    fail(context, `unknown diff op type ${JSON.stringify(op.type)}`);
}
export function validateDiff(raw, context) {
    const rec = asRecord(raw);
    if (!rec)
        fail(context, "diff must be a JSON object");
    reqString(rec, "diffId", context);
    reqString(rec, "engagementId", context);
    reqString(rec, "archiveUri", context);
    reqIso(rec, "createdAt", context);
    if (!asRecord(rec.inputHashes))
        fail(context, "inputHashes is required");
    if (!Array.isArray(rec.autoApplied) || !Array.isArray(rec.proposed) || !Array.isArray(rec.skipped)) {
        fail(context, "autoApplied/proposed/skipped must be arrays");
    }
    for (const [i, op] of rec.autoApplied.entries())
        validateDiffOp(op, `${context} autoApplied[${i}]`);
    for (const [i, op] of rec.proposed.entries())
        validateDiffOp(op, `${context} proposed[${i}]`);
    const counts = asRecord(rec.counts);
    if (!counts)
        fail(context, "counts is required");
    if (counts.autoApplied !== rec.autoApplied.length ||
        counts.proposed !== rec.proposed.length ||
        counts.skipped !== rec.skipped.length) {
        fail(context, "counts disagree with the op lists");
    }
    if (!["proposed", "applied", "partially-applied", "rejected", "failed"].includes(rec.status)) {
        fail(context, `unknown diff status ${JSON.stringify(rec.status)}`);
    }
    if (!HEX64.test(rec.sha256))
        fail(context, "sha256 must be sha256 hex");
    return raw;
}
//# sourceMappingURL=schema.js.map