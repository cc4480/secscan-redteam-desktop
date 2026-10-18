/**
 * Harness2 section-11.3 rollback: active-set edit + permanent archive move +
 * reverted EXPERIENCE.md entry + guardrail-incident flagging.
 *
 * A rollback NEVER deletes a layer. The procedure, in order:
 *  1. remove the id from the active set (`layers.setActiveLayers`, a config edit
 *     only) so the layer can no longer compose;
 *  2. MOVE the layer's directory into archive/<date>-rollback-<reason>/ (or
 *     archive/<date>-incident-<reason>/ for a guardrail incident) with a
 *     manifest recording the reason, active set before/after, measured deltas,
 *     motivating run ids and the at-adoption baseline;
 *  3. append an EXPERIENCE.md entry with `Status: reverted (<reason>, <date>)`
 *     plus the reason and the measured deltas (the section-7 writer owns the format);
 *  4. close the monitor's adoption record.
 *
 * An operator may roll back any active layer at any time by this same
 * procedure; the monitor uses it programmatically for the three section-11.5
 * rules. Rolling back an already-archived id is refused: the archive is
 * permanent, so "rollback twice" is not a delete.
 */
import { existsSync } from "node:fs";
import { activeLayerIds, layerDir, readLayer, setActiveLayers } from "./layers.js";
import { archiveDate, findArchivedLayer, moveLayersToArchive } from "./layer-archive.js";
import { formatMetricDeltas } from "./layer-headers.js";
import { appendIncident, appendFlag, closeAdoption, findAdoption, } from "./lifecycle-state.js";
import { appendRevertedExperience } from "./experience.js";
/** A refused rollback; nothing is changed when it is thrown. */
export class RollbackRefusedError extends Error {
    constructor(message) {
        super(message);
        this.name = "RollbackRefusedError";
    }
}
/**
 * Roll a layer back to the permanent archive (section 11.3). The archive is
 * never deleted and a second rollback of the same id is refused.
 */
export function rollbackLayerToArchive(input) {
    const { paths, layerId } = input;
    const reason = input.reason.trim();
    if (reason === "")
        throw new RollbackRefusedError("rollback refused: a reason is required");
    let layer = null;
    let integrity = "";
    try {
        layer = readLayer(paths, layerId);
    }
    catch (err) {
        // An active layer whose files no longer verify must still be archivable:
        // a tampered/broken layer is exactly the case a rollback must be able to
        // remove from the active set. Its bytes go to the archive untouched.
        if (!existsSync(layerDir(paths, layerId)))
            throw new RollbackRefusedError(`rollback refused: ${err.message}`);
        integrity = err.message;
        layer = { id: layerId, yaml: "", adoptedAt: "", evidenceRunId: "" };
    }
    if (layer === null) {
        const archived = findArchivedLayer(paths, layerId);
        if (archived !== null) {
            throw new RollbackRefusedError(`rollback refused: layer "${layerId}" is already archived at ${archived}; an archive is never deleted or rolled back twice`);
        }
        throw new RollbackRefusedError(`rollback refused: no installed layer "${layerId}" under ${paths.layers}`);
    }
    const now = input.now ?? new Date();
    const date = input.date ?? archiveDate(now);
    const targetClass = input.targetClass ?? layer.targetClass ?? "general";
    const cycleId = (input.cycleId ?? "").trim() === "" ? `cycle-${date}` : input.cycleId.trim();
    const activeBefore = activeLayerIds(paths);
    const activeIds = activeBefore.filter((id) => id !== layerId);
    // (1) config edit only: drop the id from the active set first.
    if (activeBefore.includes(layerId))
        setActiveLayers(paths, activeIds);
    const adoption = findAdoption(paths, layerId);
    const measuredEffect = input.measuredEffect ??
        (input.deltas !== undefined
            ? formatMetricDeltas(input.deltas, input.baseRuns, input.candidateRuns)
            : `operator rollback on ${date}; no post-adoption measurement supplied`);
    // (2) move the files into the permanent archive with a manifest.
    const archive = moveLayersToArchive({
        paths,
        layerIds: [layerId],
        kind: input.incident === true ? "incident" : "rollback",
        reason,
        date,
        now,
        manifest: {
            targetClass,
            cycleId,
            activeBefore,
            activeIds,
            operator: input.operator ?? null,
            incident: input.incident === true,
            measuredEffect,
            runIds: input.runIds ?? [],
            integrity: integrity === "" ? null : integrity,
            adoption: adoption === null
                ? null
                : { adoptedAtIso: adoption.adoptedAtIso, sAtAdoption: adoption.sAtAdoption ?? null, crAtAdoption: adoption.crAtAdoption ?? null },
        },
    });
    // (3) append the reverted lesson (append-only; never rewrites history).
    const lesson = appendRevertedExperience(paths, {
        targetClass,
        layerId,
        cycleId,
        date,
        reason,
        changed: `rolled back layer "${layerId}"${input.incident === true ? " (guardrail incident)" : ""}`,
        why: input.why ?? (input.runIds !== undefined && input.runIds.length > 0 ? `motivating runs: ${input.runIds.join(", ")}` : measuredEffect),
        measuredEffect,
    });
    // (4) the monitor no longer watches a layer that is gone.
    closeAdoption(paths, layerId, `rolled back: ${reason}`, now.getTime());
    const incidentRecord = input.incident === true
        ? raiseIncident({
            paths,
            layerId,
            targetClass,
            kind: input.incidentKind ?? "guardrail-touch",
            detail: input.incidentDetail ?? reason,
            pinned: input.pinned ?? [],
            now,
        })
        : undefined;
    return {
        layerId,
        targetClass,
        cycleId,
        archiveDir: archive.dir,
        archiveManifestPath: archive.manifestPath,
        experiencePath: lesson.path,
        activeBefore,
        activeIds,
        incident: input.incident === true,
        ...(incidentRecord !== undefined ? { incidentRecord } : {}),
    };
}
/** Record a guardrail incident and put it on the operator attention queue. */
export function raiseIncident(input) {
    const ts = (input.now ?? new Date()).toISOString();
    const record = appendIncident(input.paths, {
        ts,
        kind: input.kind,
        layerId: input.layerId,
        targetClass: input.targetClass,
        detail: input.detail,
        pinned: input.pinned ?? [],
        action: input.action ?? "deactivated and archived",
    });
    appendFlag(input.paths, {
        ts,
        kind: "guardrail-incident",
        targetClass: input.targetClass,
        layerId: input.layerId,
        detail: `INCIDENT ${input.kind} in active layer "${input.layerId}": ${input.detail} (${record.action})`,
    });
    return record;
}
//# sourceMappingURL=layer-rollback.js.map