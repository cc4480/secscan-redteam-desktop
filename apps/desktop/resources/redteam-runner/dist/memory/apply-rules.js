/**
 * Memory apply rules — extracted from apply.ts to keep the apply module under
 * the 300-line budget. Pure predicates used while approving and applying diffs.
 */
import { MemoryError } from './errors.js';
import { deriveTrust } from './trust.js';
export function requireOperator(operator) {
    const name = operator.trim();
    if (!name) {
        throw new MemoryError('SCHEMA_INVALID', 'an approval/rejection requires a named human operator (--operator <name>)');
    }
    return name;
}
/** True when the op's stored trust block disagrees with a fresh derivation (apply-time re-derivation, §7.3). */
export function trustDisagrees(op) {
    const derived = deriveTrust({
        proof: op.unit.proof,
        corroboration: op.unit.corroboration,
        contentClass: op.unit.contentClass,
        sourceRefs: op.unit.provenance.sourceRefs,
    }, op.unit.trust.derivedAt);
    return derived.tier !== op.unit.trust.tier || derived.baseScore !== op.unit.trust.baseScore;
}
//# sourceMappingURL=apply-rules.js.map