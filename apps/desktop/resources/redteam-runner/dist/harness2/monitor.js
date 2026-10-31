/**
 * Harness2 10-run auto-rollback monitor (H2-P3, spec section 11.5).
 *
 * After any adoption the monitor watches the following 10 runs from the
 * section-5 store and applies three rules: (1) S-DROP: completed-window S <
 * at-adoption S - 0.08 -> rollback; (2) CR-RISE: window CR > at-adoption CR +
 * 0.03 -> immediate rollback; (3) GUARDRAIL-TOUCH: an ACTIVE layer touching a
 * pinned guardrail (or failing verification) is deactivated at once, archived
 * and flagged as an INCIDENT.
 *
 * Every evaluation is logged (`<root>/monitor/evaluations.jsonl`), partial and
 * no-op passes included, so the monitor's reasoning is auditable. Rollbacks go
 * through lifecycle.rollbackLayerToArchive: active-set edit + permanent archive
 * move + reverted EXPERIENCE.md entry, never a delete. S is the section-8
 * composite with self-relative cost terms; the baseline is the gate candidate,
 * else the class's pre-adoption stored runs (syncAdoptions covers ANY adoption).
 */
import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { activeLayerIds } from "./layers.js";
import { isoDate, rollbackLayerToArchive } from "./lifecycle.js";
import { MONITOR_WINDOW, closeAdoption, readAdoptions, readJsonLines, } from "./lifecycle-state.js";
import { openHarness2Store } from "./store.js";
import { baseline, guardrailTouches, metricsOf, syncAdoptions, windowRuns } from "./monitor-window.js";
export { guardrailTouches } from "./monitor-window.js";
/** Rule 1: a 10-run S below the at-adoption S by more than this rolls back. */
export const S_DROP_THRESHOLD = 0.08;
/** Rule 2: a CR above the at-adoption CR by more than this rolls back immediately. */
export const CR_RISE_THRESHOLD = 0.03;
/** Audit trail, relative to `<root>`. */
export const EVALUATION_LOG = "monitor/evaluations.jsonl";
/** `<root>/monitor` (the monitor's audit trail lives outside the layer store). */
export function monitorDir(paths) {
    return join(paths.root, "monitor");
}
/** `<root>/monitor/evaluations.jsonl`. */
export function evaluationLogPath(paths) {
    return join(monitorDir(paths), "evaluations.jsonl");
}
/** Append one evaluation line; the audit trail is append-only. */
function logEvaluation(paths, evaluation) {
    const path = evaluationLogPath(paths);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(evaluation)}\n`);
}
/** Every logged evaluation, oldest first (tolerant reader; never throws). */
export function readMonitorEvaluations(paths) {
    return readJsonLines(evaluationLogPath(paths));
}
function fmt(value) {
    return value === null ? "n/a" : value.toFixed(4);
}
/** An evaluation for an adoption the monitor could not measure (logged, never silent). */
function skippedEvaluation(ts, adoption, note) {
    return {
        ts,
        layerId: adoption.layerId,
        targetClass: adoption.targetClass,
        cycleId: adoption.cycleId,
        window: 0,
        runIds: [],
        sWindow: null,
        sAtAdoption: adoption.sAtAdoption ?? null,
        sDropThreshold: S_DROP_THRESHOLD,
        crWindow: 0,
        crAtAdoption: adoption.crAtAdoption ?? 0,
        crRiseThreshold: CR_RISE_THRESHOLD,
        rules: { sDrop: false, crRise: false, guardrailTouch: false },
        action: "none",
        note,
    };
}
/**
 * Run one monitor pass: guardrail touches first, then every open adoption's
 * 10-run window. Evaluations are always logged; rollbacks happen only when
 * apply is true.
 */
export function runAutoRollbackMonitor(options) {
    const { paths } = options;
    const now = options.now ?? new Date();
    const ts = now.toISOString();
    const apply = options.apply !== false;
    const evaluations = [];
    const actions = [];
    const incidents = [];
    if (apply)
        syncAdoptions(paths);
    const ownedStore = options.store === undefined && existsSync(paths.database) ? openHarness2Store(paths) : undefined;
    const store = options.store ?? ownedStore;
    const record = (evaluation) => {
        evaluations.push(evaluation);
        logEvaluation(paths, evaluation);
    };
    try {
        // Rule 3: guardrail touches are immediate and independent of any adoption.
        for (const touch of guardrailTouches(paths)) {
            const adoption = readAdoptions(paths).find((seen) => seen.layerId === touch.layerId);
            const rollback = apply
                ? rollbackLayerToArchive({
                    paths,
                    layerId: touch.layerId,
                    reason: touch.kind === "unreadable-layer" ? "unreadable-layer" : "guardrail-touch",
                    incident: true,
                    incidentKind: touch.kind,
                    incidentDetail: touch.detail,
                    pinned: touch.pinned,
                    targetClass: adoption?.targetClass,
                    cycleId: adoption?.cycleId,
                    date: isoDate(now),
                    now,
                    measuredEffect: `immediate deactivation: ${touch.detail}`,
                    why: "guardrail-touch rule: any active layer touching a pinned guardrail is deactivated and archived at once",
                })
                : undefined;
            if (rollback !== undefined) {
                actions.push({ layerId: touch.layerId, action: "deactivated-incident", reason: touch.kind, archiveDir: rollback.archiveDir, experiencePath: rollback.experiencePath });
                if (rollback.incidentRecord !== undefined)
                    incidents.push(rollback.incidentRecord);
            }
            record({
                ts,
                layerId: touch.layerId,
                targetClass: adoption?.targetClass ?? "general",
                cycleId: adoption?.cycleId ?? "",
                window: 0,
                runIds: [],
                sWindow: null,
                sAtAdoption: null,
                sDropThreshold: S_DROP_THRESHOLD,
                crWindow: 0,
                crAtAdoption: 0,
                crRiseThreshold: CR_RISE_THRESHOLD,
                rules: { sDrop: false, crRise: false, guardrailTouch: true },
                action: apply ? "deactivated-incident" : "none",
                note: `${touch.detail}; ${apply ? "layer deactivated, archived and flagged as an incident" : "dry run: would deactivate and flag an incident"}`,
            });
        }
        // Rules 1 and 2: the 10 runs following each open adoption.
        const active = activeLayerIds(paths);
        for (const adoption of readAdoptions(paths)) {
            if (adoption.closedAtMs !== undefined)
                continue;
            if (!active.includes(adoption.layerId)) {
                if (apply)
                    closeAdoption(paths, adoption.layerId, "layer no longer active", now.getTime());
                record(skippedEvaluation(ts, adoption, "layer is not active; monitoring closed"));
                continue;
            }
            if (store === undefined) {
                record(skippedEvaluation(ts, adoption, "no section-5 store yet; nothing to evaluate"));
                continue;
            }
            const runs = windowRuns(store, adoption);
            const window = metricsOf(runs);
            const base = baseline(store, adoption);
            const sDrop = base.s !== null && runs.length >= MONITOR_WINDOW && window.s < base.s - S_DROP_THRESHOLD;
            const crRise = runs.length >= 1 && window.cr > base.cr + CR_RISE_THRESHOLD;
            const breached = sDrop || crRise;
            let action = "none";
            let note;
            const summary = `S ${fmt(window.s)} vs ${fmt(base.s)}, CR ${fmt(window.cr)} vs ${fmt(base.cr)} over ${runs.length}/${MONITOR_WINDOW} runs`;
            if (breached) {
                const reason = sDrop ? "s-drop" : "cr-rise";
                const measuredEffect = `${summary} (run ids: ${runs.map((run) => run.runId).join(", ")})`;
                if (apply) {
                    const rollback = rollbackLayerToArchive({
                        paths,
                        layerId: adoption.layerId,
                        targetClass: adoption.targetClass,
                        cycleId: adoption.cycleId,
                        reason,
                        date: isoDate(now),
                        now,
                        measuredEffect,
                        runIds: runs.map((run) => run.runId),
                        why: sDrop
                            ? `10-run S ${fmt(window.s)} is below the at-adoption S ${fmt(base.s)} - ${S_DROP_THRESHOLD}`
                            : `CR ${fmt(window.cr)} exceeds the at-adoption CR ${fmt(base.cr)} + ${CR_RISE_THRESHOLD}`,
                    });
                    actions.push({ layerId: adoption.layerId, action: "rolled-back", reason, archiveDir: rollback.archiveDir, experiencePath: rollback.experiencePath });
                    action = "rolled-back";
                    note = `${reason} rule fired: ${summary}; layer rolled back to the permanent archive`;
                }
                else {
                    note = `${reason} rule WOULD fire (dry run): ${summary}`;
                }
            }
            else if (runs.length >= MONITOR_WINDOW) {
                if (apply)
                    closeAdoption(paths, adoption.layerId, "window complete: 10 runs, no rule triggered", now.getTime());
                note = `window complete (${runs.length}/${MONITOR_WINDOW} runs): ${summary}; no rule triggered`;
            }
            else {
                note = `partial window (${runs.length}/${MONITOR_WINDOW} runs): ${summary}; no rule triggered yet`;
            }
            record({
                ts,
                layerId: adoption.layerId,
                targetClass: adoption.targetClass,
                cycleId: adoption.cycleId,
                window: runs.length,
                runIds: runs.map((run) => run.runId),
                sWindow: runs.length === 0 ? null : window.s,
                sAtAdoption: base.s,
                sDropThreshold: S_DROP_THRESHOLD,
                crWindow: window.cr,
                crAtAdoption: base.cr,
                crRiseThreshold: CR_RISE_THRESHOLD,
                rules: { sDrop, crRise, guardrailTouch: false },
                action,
                note,
            });
        }
    }
    finally {
        if (ownedStore !== undefined)
            ownedStore.close();
    }
    return { evaluations, actions, incidents, activeIds: activeLayerIds(paths) };
}
//# sourceMappingURL=monitor.js.map