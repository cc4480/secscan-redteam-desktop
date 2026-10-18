import { MAX_ACTIVE_LAYERS, activeLayerIds, assertLayerGuardrails, installLayer, readLayer, setActiveLayers, } from "./layers.js";
import { applyLayerHeader } from "./layer-headers.js";
import { archiveDate, findArchivedLayer, moveLayersToArchive } from "./layer-archive.js";
import { clearFreeze, freezeClass, readFreeze, readFreezes, recordAdoption, } from "./lifecycle-state.js";
import { appendExperience, supersedeExperience } from "./experience.js";
import { compositeScore, evaluateGate } from "./scoring.js";
/** A refused lifecycle operation; nothing is changed when it is thrown. */
export class LifecycleError extends Error {
    constructor(message) {
        super(message);
        this.name = "LifecycleError";
    }
}
/** The monitor's S for one metric window: self-relative (TOK/STEPS ratios = 1). */
export function monitorScore(metrics) {
    return compositeScore(metrics, metrics);
}
/** YYYY-MM-DD for a Date (UTC). */
export function isoDate(now = new Date()) {
    return now.toISOString().slice(0, 10);
}
/** Section-11 pre-check: a 6th adoption needs consolidation first. */
export function assertAdoptionCapacity(paths) {
    const active = activeLayerIds(paths);
    if (active.length >= MAX_ACTIVE_LAYERS) {
        throw new LifecycleError(`adoption refused: ${active.length} layers are active (cap ${MAX_ACTIVE_LAYERS}); consolidate the stack first ` +
            "(spec section 11.2). Active: " + active.join(", "));
    }
}
/** Deltas of a merged stack vs the base stack, for the header/lesson line. */
export function formatConsolidationDeltas(base, candidate) {
    const signed = (value, digits = 3) => `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
    return (`S ${signed(monitorScore(candidate) - monitorScore(base))}; ` +
        `SR ${signed(candidate.sr - base.sr)}, VF ${signed(candidate.vf - base.vf)}, ` +
        `FPR ${signed(candidate.fpr - base.fpr)}, STEPS ${signed(candidate.steps - base.steps, 1)}, ` +
        `TOK ${signed(candidate.tok - base.tok, 1)}, CR ${signed(candidate.cr - base.cr)}; ` +
        `${candidate.n} candidate / ${base.n} base runs`);
}
/** Metrics block recorded in the consolidation manifest: ids, dates, metrics. */
function consolidationMetrics(base, candidate) {
    return {
        base: { ...base },
        candidate: { ...candidate },
        sBase: monitorScore(base),
        sCandidate: monitorScore(candidate),
        sDelta: monitorScore(candidate) - monitorScore(base),
    };
}
/**
 * Consolidate the active stack into ONE merged layer (section 11.2). The gate
 * decides; on FROZEN nothing in the layer store, archive or active set changes.
 */
export function consolidateLayers(input) {
    const { paths, targetClass, mergedLayer } = input;
    const now = input.now ?? new Date();
    const date = input.date ?? archiveDate(now);
    const active = activeLayerIds(paths);
    if (active.length === 0)
        throw new LifecycleError("consolidation refused: there is no active layer stack to consolidate");
    assertLayerGuardrails(mergedLayer);
    if (mergedLayer.yaml.trim() === "")
        throw new LifecycleError(`consolidation refused: merged layer "${mergedLayer.id}" has an empty YAML body`);
    if (mergedLayer.adoptedAt.trim() === "")
        throw new LifecycleError(`consolidation refused: merged layer "${mergedLayer.id}" has no adoptedAt timestamp`);
    if (active.includes(mergedLayer.id))
        throw new LifecycleError(`consolidation refused: merged layer id "${mergedLayer.id}" is already active`);
    if (readLayer(paths, mergedLayer.id) !== null)
        throw new LifecycleError(`consolidation refused: merged layer id "${mergedLayer.id}" is already installed`);
    const oldCopy = findArchivedLayer(paths, mergedLayer.id);
    if (oldCopy !== null) {
        throw new LifecycleError(`consolidation refused: layer id "${mergedLayer.id}" already exists in the archive (${oldCopy}); ids are never reused`);
    }
    const gate = evaluateGate(input.gate);
    if (gate.verdict !== "ADOPT" || input.approve !== true) {
        const failed = gate.conditions.filter((condition) => !condition.passed).map((condition) => `#${condition.id} ${condition.name}`);
        const why = gate.verdict !== "ADOPT"
            ? `gate ${gate.verdict}${failed.length > 0 ? ` (${failed.join("; ")})` : ""}`
            : "operator approval required (approve !== true)";
        const freeze = freezeClass(paths, {
            targetClass,
            reason: `${why}; the ${active.length}-layer stack stays active and new proposals for this class are frozen until an operator clears it`,
            date,
            flaggedAt: now.toISOString(),
            verdict: gate.verdict,
        });
        return { status: "FROZEN", verdict: gate.verdict, targetClass, gate, archivedLayerIds: active, activeIds: active, freeze };
    }
    const cycleId = (input.cycleId ?? "").trim() === "" ? `cycle-${date}` : input.cycleId.trim();
    const header = {
        layerId: mergedLayer.id,
        date,
        parents: active,
        cycleId,
        metricDeltas: formatConsolidationDeltas(input.gate.base, input.gate.candidate),
        status: "active",
    };
    installLayer(paths, { ...mergedLayer, yaml: applyLayerHeader(mergedLayer.yaml, header) });
    let archive;
    try {
        archive = moveLayersToArchive({
            paths,
            layerIds: active,
            kind: "consolidated",
            date,
            now,
            manifest: {
                targetClass,
                cycleId,
                mergedLayerId: mergedLayer.id,
                activationIndex: 1,
                activeBefore: active,
                activeAfter: [mergedLayer.id],
                operator: input.operator ?? null,
                gate: { verdict: gate.verdict, score: gate.score, conditions: gate.conditions, overlap: gate.overlap },
                metrics: consolidationMetrics(input.gate.base, input.gate.candidate),
            },
        });
    }
    catch (err) {
        throw new LifecycleError(`consolidation failed while archiving the active stack: ${err.message}`);
    }
    setActiveLayers(paths, [mergedLayer.id]);
    clearFreeze(paths, targetClass);
    const notes = [];
    let superseded = 0;
    for (const id of active) {
        try {
            if (supersedeExperience(paths, { targetClass, layerId: id, by: mergedLayer.id }).marked)
                superseded += 1;
        }
        catch (err) {
            notes.push(`supersedeExperience(${id}) skipped: ${err.message}`);
        }
    }
    try {
        appendExperience(paths, {
            date,
            targetClass,
            layerId: mergedLayer.id,
            cycleId,
            changed: `consolidated ${active.length} active layers into "${mergedLayer.id}"`,
            why: `active stack full (${active.length}/${MAX_ACTIVE_LAYERS}): ${active.join(", ")}`,
            measuredEffect: formatConsolidationDeltas(input.gate.base, input.gate.candidate),
            status: { kind: "active" },
        });
    }
    catch (err) {
        notes.push(`appendExperience skipped: ${err.message}`);
    }
    recordAdoption(paths, {
        layerId: mergedLayer.id,
        targetClass,
        cycleId,
        adoptedAtMs: now.getTime(),
        adoptedAtIso: now.toISOString(),
        sAtAdoption: monitorScore(input.gate.candidate),
        crAtAdoption: input.gate.candidate.cr,
    });
    return {
        status: "ADOPTED",
        verdict: gate.verdict,
        targetClass,
        gate,
        archivedLayerIds: active,
        mergedLayerId: mergedLayer.id,
        activationIndex: 1,
        archiveDir: archive.dir,
        archiveManifestPath: archive.manifestPath,
        activeIds: [mergedLayer.id],
        superseded,
        ...(notes.length > 0 ? { experienceNotes: notes } : {}),
    };
}
/** Every consolidation freeze currently in force (the operator queue). */
export function consolidationFreezes(paths) {
    return readFreezes(paths);
}
/** The class's consolidation freeze, or null. */
export function consolidationFreeze(paths, targetClass) {
    return readFreeze(paths, targetClass);
}
// Rollback + incident reporting live in their own module to stay inside the
// per-file budget; re-exported here so callers use one lifecycle surface.
export { raiseIncident, rollbackLayerToArchive } from "./layer-rollback.js";
//# sourceMappingURL=lifecycle.js.map