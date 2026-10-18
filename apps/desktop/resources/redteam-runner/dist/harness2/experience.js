/**
 * Harness2 EXPERIENCE.md writers + approval-gated adopt/rollback (H2-P3, spec 7).
 *
 * The format and the read side live in ./experience-record.ts, re-exported here
 * so callers import one module.
 *
 * APPEND-ONLY RULE (exact):
 *  - a new record is APPENDED after the existing bytes; the file is never
 *    re-rendered, so prose between records, malformed blocks and history survive;
 *  - the ONLY in-place edit allowed is replacing the `- Status:` line of ONE
 *    existing record. That record's heading, its other four bullets, its
 *    position and every other byte of the file stay byte-identical;
 *  - a record is never deleted, reordered or merged. `append-only` therefore
 *    means: append new records, plus single-line, status-only transitions.
 *
 * STATUS TRANSITIONS: adopt -> append a record with Status `active`; supersede ->
 * flip ONE active record's Status to `superseded (-> <layer>)`; revert/rollback ->
 * flip the layer's active record to `reverted (<reason>, <date>)` AND append one
 * new record carrying that same reverted Status (the rollback is a new fact).
 *
 * SAFETY: adoptVerdict is the ONLY adoption path. It refuses unless the probe
 * verdict says adopted AND explicit approval is true, then re-checks both YAML
 * bodies for pinned guardrails (src/safety, src/policy, src/gate.ts,
 * src/accountability, auth-gate, the guardrails component) before installing the
 * layer, activating it and appending the measured lesson.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PINNED_COMPONENT } from "./contract.js";
import { COMPONENT_PATHS } from "./harness-stamp.js";
import { activeLayerIds, installLayer, readLayer, removeLayer, setActiveLayers } from "./layers.js";
import { experienceKey, isExperienceToken, isIsoDate, isoDateOf, listExperience, oneLine, parseExperience, readExperience, readExperienceReport, renderEntry, renderStatus, resolveExperiencePath, sanitizeTargetClass, scanExperience, } from "./experience-record.js";
export * from "./experience-record.js";
/** Thrown whenever adoption, a status transition or a rollback is refused; nothing is written before it. */
export class AdoptRefusedError extends Error {
    constructor(message) {
        super(message);
        this.name = "AdoptRefusedError";
    }
}
const DELTA_KEYS = ["vulnsFound", "falsePositives", "steps", "tokensIn", "tokensOut"];
const PINNED_NEEDLES = [...COMPONENT_PATHS[PINNED_COMPONENT], PINNED_COMPONENT, "auth-gate"];
/** Today in UTC, the default record date. */
function today() { return new Date().toISOString().slice(0, 10); }
/** Tmp-write then rename, so an EXPERIENCE.md is never seen half written. */
function atomicWrite(path, body) {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`;
    try {
        writeFileSync(tmp, body);
        try {
            renameSync(tmp, path);
        }
        catch {
            rmSync(path, { force: true });
            renameSync(tmp, path);
        }
    }
    finally {
        if (existsSync(tmp))
            rmSync(tmp, { force: true });
    }
}
/** The pinned-guardrail token a layer/proposal YAML references, if any (slash and whitespace normalized). */
export function findPinnedGuardrailReference(yaml) {
    const normalized = yaml.toLowerCase().split("\\").join("/").replace(/\s+/g, "");
    for (const needle of PINNED_NEEDLES) {
        if (normalized.includes(needle.toLowerCase().split("\\").join("/")))
            return needle;
    }
    return null;
}
/** Refuse to persist a record the parser would later discard. */
function assertAppendable(record) {
    const bad = (problem) => { throw new Error(`invalid EXPERIENCE record (${record.targetClass}): ${problem}`); };
    if (!isIsoDate(record.date))
        bad("date must be YYYY-MM-DD");
    if (!isExperienceToken(record.cycleId))
        bad("cycle id must be a token ([A-Za-z0-9][A-Za-z0-9._-]*, max 128)");
    if (record.layerId !== undefined && !isExperienceToken(record.layerId))
        bad("layer id must be a token ([A-Za-z0-9][A-Za-z0-9._-]*, max 128)");
    if (oneLine(record.targetClass) === "")
        bad("target class must not be empty");
    if (oneLine(record.changed) === "")
        bad("changed must not be empty");
    if (oneLine(record.why) === "")
        bad("why must not be empty");
    if (oneLine(record.measuredEffect) === "")
        bad("measured effect must not be empty");
    if (record.status.kind === "superseded" && !isExperienceToken(record.status.by))
        bad("superseded needs a valid layer id");
    if (record.status.kind === "reverted" && (!isIsoDate(record.status.date) || oneLine(record.status.reason) === ""))
        bad("reverted needs a reason and a YYYY-MM-DD date");
}
/**
 * Append one section-7 record: dedupe on (date, layerId, cycleId, changed) and
 * leave every existing byte untouched (true append, never a canonical rewrite).
 */
export function appendExperience(paths, record) {
    assertAppendable(record);
    const path = resolveExperiencePath(paths, record.targetClass);
    const existing = existsSync(path) ? readFileSync(path, "utf8").replace(/^\uFEFF/, "") : "";
    const parsed = parseExperience(existing, record.targetClass);
    const total = parsed.entries.length;
    if (parsed.entries.some((seen) => experienceKey(seen) === experienceKey(record)))
        return { path, appended: false, total };
    const header = `# EXPERIENCE - ${sanitizeTargetClass(record.targetClass)}`;
    const base = existing.trim() === "" ? header : existing.replace(/\s+$/, "");
    atomicWrite(path, `${base}\n\n${renderEntry(record)}\n`);
    return { path, appended: true, total: total + 1 };
}
/** True when a record satisfies a selector (unset selector fields match everything). */
function matchesSelector(record, selector) {
    if (selector.date !== undefined && record.date !== selector.date)
        return false;
    if (selector.layerId !== undefined && record.layerId !== selector.layerId)
        return false;
    if (selector.cycleId !== undefined && record.cycleId !== selector.cycleId)
        return false;
    if (selector.status !== undefined && record.status.kind !== selector.status)
        return false;
    return true;
}
/**
 * The ONLY in-place write: replace the `- Status:` line of exactly one record.
 * Refuses (typed error, nothing written) unless exactly one record matches and
 * the status actually changes; every other line stays byte-identical.
 */
export function markExperienceStatus(paths, targetClass, selector, status) {
    const path = resolveExperiencePath(paths, targetClass);
    if (!existsSync(path))
        throw new AdoptRefusedError(`status change refused: no EXPERIENCE.md for class "${targetClass}"`);
    const raw = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
    const scan = scanExperience(raw, targetClass);
    const matches = scan.blocks.filter((block) => block.record !== null && matchesSelector(block.record, selector));
    if (matches.length !== 1)
        throw new AdoptRefusedError(`status change refused: ${matches.length} records match the selector; exactly one is required`);
    const block = matches[0];
    const record = block.record;
    if (renderStatus(record.status) === renderStatus(status))
        return { path, marked: false, record };
    if (block.statusLine < 0)
        throw new AdoptRefusedError(`status change refused: record ${record.date}/${record.cycleId} has no Status line to flip`);
    const lines = [...scan.lines];
    lines[block.statusLine] = `- Status: ${renderStatus(status)}`;
    atomicWrite(path, lines.join("\n"));
    return { path, marked: true, record: { ...record, status } };
}
/** Mark an active record superseded by a newer layer (consolidation/replacement). */
export function supersedeExperience(paths, input) {
    if (!isExperienceToken(input.by))
        throw new AdoptRefusedError(`supersede refused: "${input.by}" is not a valid layer id`);
    return markExperienceStatus(paths, input.targetClass, { layerId: input.layerId, status: "active" }, { kind: "superseded", by: input.by });
}
/**
 * Record a rollback: flip the layer's currently active record to `reverted`
 * (status line only) and APPEND one new record carrying that same reverted
 * status, the reason and the measured deltas before the rollback.
 */
export function appendRevertedExperience(paths, input) {
    const date = input.date ?? today();
    if (!isIsoDate(date))
        throw new AdoptRefusedError(`revert refused: "${date}" is not a YYYY-MM-DD date`);
    const report = readExperienceReport(paths, input.targetClass);
    const adoption = input.layerId === undefined ? undefined
        : report.entries.filter((entry) => entry.layerId === input.layerId && entry.status.kind === "active").pop();
    const cycleId = input.cycleId ?? adoption?.cycleId ?? `cycle-${date}`;
    const status = { kind: "reverted", reason: oneLine(input.reason), date };
    let marked = 0;
    if (adoption !== undefined) {
        const flipped = markExperienceStatus(paths, input.targetClass, { date: adoption.date, layerId: adoption.layerId, cycleId: adoption.cycleId }, status);
        marked = flipped.marked ? 1 : 0;
    }
    const entry = {
        date,
        targetClass: input.targetClass,
        ...(input.layerId !== undefined ? { layerId: input.layerId } : {}),
        cycleId,
        changed: input.changed,
        why: input.why,
        measuredEffect: input.measuredEffect,
        status,
    };
    return { path: appendExperience(paths, entry).path, entry, marked };
}
/** The five metric deltas plus the compared run counts: the measured effect. */
function formatMeasuredEffect(verdict) {
    const deltas = DELTA_KEYS.map((key) => `${key} ${verdict.deltas[key] >= 0 ? "+" : ""}${verdict.deltas[key]}`).join(", ");
    return `${deltas} (n=${verdict.baseRuns} base / ${verdict.candidateRuns} candidate runs)`;
}
/** The target class whose EXPERIENCE.md mentions a layer, if any. */
function classForLayer(paths, layerId) {
    for (const info of listExperience(paths))
        if (readExperience(paths, info.targetClass).some((entry) => entry.layerId === layerId))
            return info.targetClass;
    return undefined;
}
/** The `- Why (...)` value: the motivating run id plus the rationale when known. */
function whyFor(evidenceRunId, rationale) { return [oneLine(evidenceRunId), oneLine(rationale)].filter((part) => part !== "").join("; ") || "no motivating run id recorded"; }
/**
 * The ONLY adoption path: refuses unless verdict.adopted AND approve === true,
 * re-checks pinned guardrails (defense in depth), installs + activates the
 * layer and appends the section-7 lesson with Status active. Nothing is written
 * when refused.
 */
export function adoptVerdict(input) {
    const { paths, proposal, layer, verdict, approve } = input;
    if (approve !== true)
        throw new AdoptRefusedError("adopt refused: explicit operator approval is required (approve === true)");
    if (verdict.adopted !== true)
        throw new AdoptRefusedError(`adopt refused: verdict "${verdict.proposalId}" is not adopted (${verdict.reason})`);
    if (verdict.proposalId !== proposal.id)
        throw new AdoptRefusedError(`adopt refused: verdict is for "${verdict.proposalId}", not proposal "${proposal.id}"`);
    if (proposal.component === PINNED_COMPONENT)
        throw new AdoptRefusedError(`adopt refused: "${PINNED_COMPONENT}" is pinned and can never be tuned`);
    if (!Number.isInteger(verdict.tokensSpent) || verdict.tokensSpent < 0)
        throw new AdoptRefusedError("adopt refused: verdict.tokensSpent must be a non-negative integer");
    if (layer.yaml.trim() === "")
        throw new AdoptRefusedError(`adopt refused: layer "${layer.id}" has an empty YAML body`);
    const pinned = findPinnedGuardrailReference(layer.yaml) ?? findPinnedGuardrailReference(proposal.yaml);
    if (pinned !== null)
        throw new AdoptRefusedError(`adopt refused: layer "${layer.id}" touches pinned guardrail "${pinned}"`);
    const date = isoDateOf(layer.adoptedAt) ?? today();
    const rationale = oneLine(proposal.rationale) === "" ? verdict.reason : proposal.rationale;
    const record = {
        date,
        targetClass: proposal.targetClass,
        layerId: layer.id,
        cycleId: input.cycleId ?? `cycle-${date}`,
        changed: `adopted layer "${layer.id}" for the ${proposal.component} component`,
        why: whyFor(layer.evidenceRunId, rationale),
        measuredEffect: formatMeasuredEffect(verdict),
        status: { kind: "active" },
    };
    assertAppendable(record);
    const installed = installLayer(paths, layer);
    try {
        setActiveLayers(paths, [...activeLayerIds(paths), installed.layer.id]);
    }
    catch (error) {
        removeLayer(paths, layer.id);
        throw error;
    }
    return { layerId: layer.id, experiencePath: appendExperience(paths, record).path };
}
/**
 * Remove an adopted layer and record the rollback: the layer's active record is
 * flipped to `reverted` (status line only) and a new reverted record is
 * appended, so the history is never silently rewritten or deleted.
 */
export function rollbackLayer(input) {
    const { paths, layerId } = input;
    const installed = readLayer(paths, layerId);
    if (installed === null || !removeLayer(paths, layerId))
        throw new AdoptRefusedError(`rollback refused: no adopted layer "${layerId}" is installed`);
    const targetClass = installed.targetClass ?? classForLayer(paths, layerId) ?? "general";
    const reason = oneLine(input.reason ?? "") === "" ? "operator rollback: the layer is no longer installed" : oneLine(input.reason ?? "");
    const date = today();
    const result = appendRevertedExperience(paths, {
        targetClass,
        layerId,
        date,
        reason,
        changed: `rolled back layer "${layerId}"`,
        why: whyFor(installed.evidenceRunId, `removal reason: ${reason}`),
        measuredEffect: "layer removed from the active set; earlier measured deltas are retained unchanged above (n=0 new runs)",
    });
    return { layerId, experiencePath: result.path, lesson: result.entry };
}
//# sourceMappingURL=experience.js.map