/**
 * Deterministic proposal extractors (brief §7.2). Free-form model text
 * is never an extractor: a model's words reach memory only as records
 * the runner already adjudicated (registry verdicts, cell outcomes) or
 * as `target-derived-claim` intake. Every projector emits DRAFTS —
 * validation, trust derivation, and sealing happen in commit.ts /
 * store.ts, and an extractor never proposes a tier.
 */
import { computeUnitId, hashRecord } from "./schema.js";
import { normalizeHost, scopeKeyForClass, scopeKeyForHosts } from "./scope.js";
import { sourceKeyFor } from "./trust.js";
export const EXTRACTOR_VERSIONS = {
    "registry-projector": "1",
    "trajectory-projector": "1",
    "experience-projector": "1",
    "target-derived-intake": "1",
};
function extractor(name, input) {
    return { name, version: EXTRACTOR_VERSIONS[name] ?? "1", inputHash: hashRecord(input) };
}
function engagementScopeForHost(scope, host, stack, appType) {
    const hosts = [normalizeHost(host)];
    return {
        kind: "engagement-target",
        scopeKey: scopeKeyForHosts(hosts),
        hosts,
        stack: stack.map((s) => s.toLowerCase()),
        ...(appType ? { appType } : {}),
        originEngagementIds: [...scope.originEngagementIds],
    };
}
/**
 * Project every registry entry of the engagement to a `finding` /
 * `killed-hypothesis` unit. Content is a direct, field-for-field
 * projection of a proof-bearing record — no semantic transformation —
 * so these ride the auto-apply lane (§7.2). `cellState` is copied from
 * the matching live finding's adjudication, never asserted here.
 *
 * @param input - The engagement's entries and scope.
 * @returns One auto-lane proposal per entry.
 */
export function projectRegistryEntries(input) {
    const proposals = [];
    for (const entry of input.entries) {
        const scope = engagementScopeForHost(input.scope, entry.target.host, entry.target.stack, entry.target.appType);
        const base = {
            schemaVersion: 1,
            scope,
            provenance: {
                sourceClass: "registry",
                sourceEngagementId: input.engagementId,
                sourceRefs: [
                    { kind: "registry-entry", uri: "engagements/registry.json", registryEntryId: entry.id },
                ],
                derivedFromUnitIds: [],
                extractor: extractor("registry-projector", entry),
                createdAt: input.nowIso,
                createdBy: "runner",
            },
            corroboration: { independentCount: 0, sourceKeys: [sourceKeyFor("registry", input.engagementId)] },
            contentClass: "normal",
            attackIds: entry.attackId ? [entry.attackId.toUpperCase()] : [],
            stack: entry.target.stack.map((s) => s.toLowerCase()),
        };
        if (entry.kind === "confirmed") {
            const live = (input.liveFindings ?? []).find((f) => f.vulnClass === entry.vulnClass && f.attackId === entry.attackId);
            const proven = live?.cellState === "proven";
            const auditRef = `${input.engagementId}/events.jsonl`;
            const claim = `${entry.vulnClass} confirmed on ${entry.target.host} — ${entry.technique}`;
            proposals.push({
                lane: "auto",
                projector: "registry-projector",
                draft: {
                    ...base,
                    unitId: computeUnitId(scope.scopeKey, "finding", claim, `registry-entry:${entry.id}`),
                    kind: "finding",
                    claim,
                    body: [
                        `Technique: ${entry.technique}`,
                        `Payload pattern: ${entry.payloadPattern}`,
                        `Evidence: ${entry.evidenceRef}`,
                        `Severity: ${entry.severity}`,
                        ...(entry.owasp ? [`OWASP: ${entry.owasp}`] : []),
                        `Recorded: ${entry.date}`,
                    ].join("\n"),
                    proof: proven
                        ? {
                            state: "proven",
                            receipts: [
                                { kind: "evidence", ref: entry.evidenceRef },
                                { kind: "negative-control", ref: auditRef },
                            ],
                            registryEntryId: entry.id,
                            cellState: "proven",
                            negativeControlReceiptRef: auditRef,
                        }
                        : {
                            state: "confirmed",
                            receipts: [{ kind: "registry-entry", ref: entry.evidenceRef }],
                            registryEntryId: entry.id,
                            ...(live?.cellState ? { cellState: live.cellState } : {}),
                        },
                    tags: [entry.vulnClass],
                    vulnClass: entry.vulnClass,
                },
            });
        }
        else {
            const claim = entry.hypothesis;
            proposals.push({
                lane: "auto",
                projector: "registry-projector",
                draft: {
                    ...base,
                    unitId: computeUnitId(scope.scopeKey, "killed-hypothesis", claim, `registry-entry:${entry.id}`),
                    kind: "killed-hypothesis",
                    claim,
                    body: [`Killing observation: ${entry.killingObservation}`, `Recorded: ${entry.date}`].join("\n"),
                    proof: {
                        state: "killed",
                        receipts: [{ kind: "registry-entry", ref: entry.id }],
                        registryEntryId: entry.id,
                    },
                    tags: entry.vulnClass ? [entry.vulnClass] : [],
                    ...(entry.vulnClass ? { vulnClass: entry.vulnClass } : {}),
                },
            });
        }
    }
    return proposals;
}
/**
 * Project the run's outcome to at most one `trajectory-lesson` unit,
 * class-scoped by the caller's `deriveTargetClass` result. A pure
 * failure-mode record (failure mode + mechanical counts) is a direct
 * projection and rides the auto lane; an outcome lesson is an
 * interpretation and waits for an operator (§7.2). Claim and body carry
 * no host-specific values — the class scope binding (§4.2) forbids them;
 * the target class itself lives in the scope fields only.
 *
 * @param input - The run's outcome facts.
 * @returns Zero or one proposal.
 */
export function projectTrajectory(input) {
    const failed = !!input.failureMode && input.failureMode !== "none";
    const claim = failed
        ? `Engagement ended ${input.outcome}: failure mode ${input.failureMode} (${input.confirmedCount} confirmed / ${input.killedCount} killed)`
        : `Engagement ended ${input.outcome} (${input.confirmedCount} confirmed / ${input.killedCount} killed)`;
    const scope = {
        kind: "target-class",
        scopeKey: scopeKeyForClass(input.targetClass),
        hosts: [],
        targetClass: input.targetClass,
        stack: [],
        originEngagementIds: [input.engagementId],
    };
    return [
        {
            lane: failed ? "auto" : "proposed",
            projector: "trajectory-projector",
            draft: {
                schemaVersion: 1,
                unitId: computeUnitId(scope.scopeKey, "trajectory-lesson", claim, `trajectory:${input.engagementId}`),
                kind: "trajectory-lesson",
                claim,
                body: [
                    `Outcome: ${input.outcome}`,
                    `Failure mode: ${input.failureMode ?? "none"}`,
                    ...(input.haltReason ? [`Halt reason: ${input.haltReason}`] : []),
                    ...(input.steps !== undefined ? [`Steps: ${input.steps}`] : []),
                    `Confirmed: ${input.confirmedCount} · Killed: ${input.killedCount}`,
                ].join("\n"),
                scope,
                targetClass: input.targetClass,
                provenance: {
                    sourceClass: "trajectory",
                    sourceEngagementId: input.engagementId,
                    sourceRefs: [{ kind: "trajectory", uri: `${input.engagementId}/trajectory.json` }],
                    derivedFromUnitIds: [],
                    extractor: extractor("trajectory-projector", input),
                    createdAt: input.nowIso,
                    createdBy: "runner",
                },
                proof: { state: "unproven", receipts: [] },
                corroboration: { independentCount: 0, sourceKeys: [sourceKeyFor("trajectory", input.engagementId)] },
                contentClass: "normal",
                tags: [],
                attackIds: [],
                stack: [],
            },
        },
    ];
}
/**
 * Project adopted (status `active`) EXPERIENCE.md records that have no
 * unit yet to `experience-lesson` units, class-scoped by the record's
 * target class. Proposed lane: a lesson is an interpretation until a
 * named operator approves it (§7.2). Reverted/superseded records are not
 * projected in v1; the commit records each as a DELETE_NOT_SUPPORTED_V1
 * skip in the diff (v1 has no delete op — see commit.ts).
 *
 * @param input - The parsed records and their file URI.
 * @returns One proposed-lane proposal per active record.
 */
export function projectExperience(input) {
    const proposals = [];
    for (const record of input.records) {
        if (record.status.kind !== "active")
            continue;
        const claim = record.changed;
        const scope = {
            kind: "target-class",
            scopeKey: scopeKeyForClass(record.targetClass),
            hosts: [],
            targetClass: record.targetClass,
            stack: [],
            originEngagementIds: [],
        };
        const refUri = `experience-record:${record.targetClass}/${record.date}/${record.layerId ?? "general"}/${record.cycleId}`;
        proposals.push({
            lane: "proposed",
            projector: "experience-projector",
            draft: {
                schemaVersion: 1,
                unitId: computeUnitId(scope.scopeKey, "experience-lesson", claim, refUri),
                kind: "experience-lesson",
                claim,
                body: [
                    `Changed: ${record.changed}`,
                    `Why: ${record.why}`,
                    `Measured effect: ${record.measuredEffect}`,
                    `Recorded: ${record.date} · Cycle: ${record.cycleId}`,
                ].join("\n"),
                scope,
                targetClass: record.targetClass,
                provenance: {
                    sourceClass: "experience",
                    sourceRefs: [{ kind: "experience-record", uri: input.fileUri }],
                    derivedFromUnitIds: [],
                    extractor: extractor("experience-projector", record),
                    createdAt: input.nowIso,
                    createdBy: "runner",
                },
                proof: { state: "unproven", receipts: [] },
                corroboration: { independentCount: 0, sourceKeys: [sourceKeyFor("experience", record.targetClass)] },
                contentClass: "normal",
                tags: [],
                attackIds: [],
                stack: [],
            },
        });
    }
    return proposals;
}
/**
 * Intake one target-asserted claim. The ONLY shape target content may
 * enter memory in: `target-derived-claim`, engagement-target scope,
 * `target-derived-untrusted` content class, unproven — it keeps the
 * §4.3 hard cap until independent corroboration exists. The claim is
 * the normalized text capped at the §4.1 budget; the body carries the
 * fuller capture.
 *
 * @param input - The captured claim and its origin.
 * @returns One proposed-lane, untrusted proposal.
 */
export function intakeTargetDerivedClaim(input) {
    const normalized = input.text.trim().replace(/\s+/g, " ");
    const hosts = [normalizeHost(input.host)];
    const scope = {
        kind: "engagement-target",
        scopeKey: scopeKeyForHosts(hosts),
        hosts,
        stack: [],
        originEngagementIds: [input.engagementId],
    };
    const claim = normalized.slice(0, 2000);
    return {
        lane: "proposed",
        projector: "target-derived-intake",
        draft: {
            schemaVersion: 1,
            unitId: computeUnitId(scope.scopeKey, "target-derived-claim", claim, input.sourceUri),
            kind: "target-derived-claim",
            claim,
            body: normalized.slice(0, 20000),
            scope,
            provenance: {
                sourceClass: "target-content",
                sourceEngagementId: input.engagementId,
                sourceRefs: [{ kind: "target-response", uri: input.sourceUri }],
                derivedFromUnitIds: [],
                extractor: extractor("target-derived-intake", { uri: input.sourceUri, text: normalized }),
                createdAt: input.nowIso,
                createdBy: "runner",
            },
            proof: { state: "unproven", receipts: [] },
            corroboration: {
                independentCount: 0,
                sourceKeys: [sourceKeyFor("target-content", input.engagementId)],
            },
            contentClass: "target-derived-untrusted",
            tags: [],
            attackIds: [],
            stack: [],
        },
    };
}
//# sourceMappingURL=extract.js.map