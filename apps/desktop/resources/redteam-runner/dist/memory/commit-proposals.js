/**
 * Phase-2 proposal processing, extracted from `commit.ts` to keep that
 * module inside the 300-line file budget: per-proposal validation,
 * corroboration handling and lane routing, plus the per-projector
 * accounting the schema-break check reads. Behaviour is unchanged.
 */
import { MemoryError } from "./errors.js";
import { validateUnit } from "./schema.js";
import { assertScopeBinding } from "./scope.js";
import { finalizeUnit } from "./store.js";
import { evaluateCorroboration } from "./trust.js";
function contentMatchesExisting(existing, draft) {
    return existing.claim === draft.claim && existing.body === draft.body && existing.proof.state === draft.proof.state;
}
export function processProposals(input, proposals, diffId) {
    const { store } = input;
    const outcome = { autoApplied: [], proposed: [], skipped: [], perProjector: new Map() };
    const account = (projector) => {
        let entry = outcome.perProjector.get(projector);
        if (!entry) {
            entry = { proposed: 0, skipped: 0, landed: 0, noChange: 0 };
            outcome.perProjector.set(projector, entry);
        }
        return entry;
    };
    let opSeq = 0;
    const nextOpId = () => `op-${String((opSeq += 1)).padStart(3, "0")}`;
    for (const proposal of proposals) {
        const tally = account(proposal.projector);
        tally.proposed += 1;
        const skip = (reason) => {
            tally.skipped += 1;
            if (reason === "DUPLICATE_NO_CHANGE")
                tally.noChange += 1;
            outcome.skipped.push({ op: { projector: proposal.projector, unitId: proposal.draft.unitId }, reason });
        };
        try {
            const existing = store.getUnit(proposal.draft.unitId);
            if (existing && contentMatchesExisting(existing, proposal.draft)) {
                skip("DUPLICATE_NO_CHANGE");
                continue;
            }
            if (existing && proposal.lane === "auto") {
                // Re-projection of a known unit = a corroboration event (§7.2):
                // append a new version only when the corroboration is independent.
                const candidateKey = proposal.draft.corroboration.sourceKeys[0] ?? "";
                const verdict = evaluateCorroboration({
                    sourceKeys: existing.corroboration.sourceKeys,
                    artifactSha256s: existing.provenance.sourceRefs
                        .map((r) => r.sha256)
                        .filter((h) => typeof h === "string"),
                }, {
                    sourceClass: proposal.draft.provenance.sourceClass,
                    sourceKey: candidateKey,
                    artifactSha256: proposal.draft.provenance.sourceRefs[0]?.sha256,
                });
                if (!verdict.counted) {
                    skip("DUPLICATE_NO_CHANGE");
                    continue;
                }
                const draft = {
                    ...proposal.draft,
                    version: existing.version + 1,
                    corroboration: {
                        independentCount: existing.corroboration.independentCount + 1,
                        sourceKeys: [...existing.corroboration.sourceKeys, candidateKey],
                        lastCorroboratedAt: input.nowIso,
                    },
                };
                const unit = finalizeUnit(draft, input.nowIso);
                validateUnit(unit, "commit corroboration");
                assertScopeBinding(unit);
                store.appendUnitVersion(unit, {
                    status: "active",
                    by: "runner",
                    reason: "MECHANICAL_PROJECTION_CORROBORATION",
                    diffId,
                    at: input.nowIso,
                });
                outcome.autoApplied.push({ opId: nextOpId(), type: "create", unit });
                tally.landed += 1;
                continue;
            }
            const draft = existing ? { ...proposal.draft, version: existing.version + 1 } : proposal.draft;
            const unit = finalizeUnit(draft, input.nowIso);
            validateUnit(unit, "commit proposal");
            assertScopeBinding(unit);
            if (proposal.lane === "auto") {
                store.appendUnitVersion(unit, {
                    status: "active",
                    by: "runner",
                    reason: "MECHANICAL_PROJECTION",
                    diffId,
                    at: input.nowIso,
                });
                outcome.autoApplied.push({ opId: nextOpId(), type: "create", unit });
            }
            else if (existing) {
                outcome.proposed.push({
                    opId: nextOpId(),
                    type: "supersede",
                    unitId: existing.unitId,
                    baseVersion: existing.version,
                    baseHash: existing.hash,
                    unit,
                });
            }
            else {
                outcome.proposed.push({ opId: nextOpId(), type: "create", unit });
            }
            tally.landed += 1;
        }
        catch (err) {
            if (err instanceof MemoryError) {
                skip(err.code);
                continue;
            }
            throw err;
        }
    }
    return outcome;
}
//# sourceMappingURL=commit-proposals.js.map