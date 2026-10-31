/**
 * Harness2 monitor window math (H2-P3, spec section 11.5): the section-5 store
 * read side of the auto-rollback monitor, kept separate from the decision code
 * so every file stays inside the 300-line budget.
 *
 * `syncAdoptions` closes the integration gap for adoptions that did not go
 * through the consolidation path: any ACTIVE layer with no adoption record gets
 * one derived from its on-disk `meta.json` (installedAt is the adoption instant)
 * and from the layer header's cycle id. That is what makes the monitor watch
 * "the 10 runs following ANY adoption", including adoptions made through
 * experience.adoptVerdict, without that module needing to know about the
 * monitor.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { activeLayerIds, checkLayerGuardrails, layerDir, readLayer } from "./layers.js";
import { readLayerHeader } from "./layer-headers.js";
import { MONITOR_WINDOW, readAdoptions, recordAdoption } from "./lifecycle-state.js";
import { computeMetrics, fromRunRow } from "./scoring.js";
import { monitorScore } from "./lifecycle.js";
/** One class's stored runs for a monitor window, oldest first. */
export function windowRuns(store, record, before = false) {
    const rows = store.listRuns({ targetClass: record.targetClass, limit: 500 });
    const selected = rows
        .filter((row) => (before ? row.ts < record.adoptedAtMs : row.ts >= record.adoptedAtMs))
        .sort((a, b) => (before ? b.ts - a.ts : a.ts - b.ts));
    return before ? selected.slice(0, MONITOR_WINDOW).reverse() : selected.slice(0, MONITOR_WINDOW);
}
/** Section-8 self-relative S and CR for a set of runs. */
export function metricsOf(rows) {
    const metrics = computeMetrics(rows.map(fromRunRow));
    return { s: monitorScore(metrics), cr: metrics.cr };
}
/**
 * The at-adoption baseline the window is compared to: the gate candidate score
 * recorded at adoption when present, otherwise derived from the class's stored
 * runs before the adoption (S) plus their CR.
 */
export function baseline(store, record) {
    if (record.sAtAdoption !== undefined)
        return { s: record.sAtAdoption, cr: record.crAtAdoption ?? 0 };
    const runs = windowRuns(store, record, true);
    if (runs.length === 0)
        return { s: null, cr: record.crAtAdoption ?? 0 };
    const derived = metricsOf(runs);
    return { s: derived.s, cr: record.crAtAdoption ?? derived.cr };
}
/** Read a layer's meta.json tolerantly (only the fields syncAdoptions needs). */
function readMeta(paths, layerId) {
    try {
        const raw = JSON.parse(readFileSync(join(layerDir(paths, layerId), "meta.json"), "utf8"));
        return raw !== null && typeof raw === "object" ? raw : null;
    }
    catch {
        return null;
    }
}
/** Epoch ms of a layer's adoption: installedAt, else adoptedAt, else now (never matches a window but is logged). */
function adoptedAtMs(meta) {
    for (const name of ["installedAt", "adoptedAt"]) {
        const value = meta?.[name];
        if (typeof value === "string") {
            const parsed = Date.parse(value);
            if (Number.isFinite(parsed))
                return parsed;
        }
    }
    return Date.now();
}
/**
 * Register every ACTIVE layer that has no adoption record yet, deriving the
 * baseline from its files and the store. Returns the records created.
 */
export function syncAdoptions(paths) {
    const known = new Set(readAdoptions(paths).map((record) => record.layerId));
    const created = [];
    for (const layerId of activeLayerIds(paths)) {
        if (known.has(layerId))
            continue;
        const meta = readMeta(paths, layerId);
        let cycleId = "";
        try {
            const layer = readFileSync(join(layerDir(paths, layerId), "layer.yml"), "utf8");
            cycleId = readLayerHeader(layer)?.cycleId ?? "";
        }
        catch {
            cycleId = "";
        }
        const targetClass = typeof meta?.["targetClass"] === "string" ? meta["targetClass"] : "general";
        const adopted = adoptedAtMs(meta);
        const createdAt = new Date(adopted).toISOString();
        const record = {
            layerId,
            targetClass,
            cycleId: cycleId.trim() === "" ? `cycle-${createdAt.slice(0, 10)}` : cycleId,
            adoptedAtMs: adopted,
            adoptedAtIso: createdAt,
        };
        created.push(recordAdoption(paths, record));
    }
    return created;
}
/** Scan the ACTIVE layers for pinned-guardrail touches or failed integrity. */
export function guardrailTouches(paths) {
    const touches = [];
    for (const layerId of activeLayerIds(paths)) {
        try {
            const layer = readLayer(paths, layerId);
            if (layer === null) {
                touches.push({ layerId, kind: "unreadable-layer", pinned: [], detail: "active layer disappeared from the layer store" });
                continue;
            }
            const check = checkLayerGuardrails(layer.yaml);
            if (!check.allowed) {
                touches.push({
                    layerId,
                    kind: "guardrail-touch",
                    pinned: check.pinned,
                    detail: `active layer "${layerId}" references pinned guardrails (${check.pinned.join(", ")})`,
                });
            }
        }
        catch (err) {
            touches.push({ layerId, kind: "unreadable-layer", pinned: [], detail: `active layer "${layerId}" failed verification: ${err.message}` });
        }
    }
    return touches;
}
//# sourceMappingURL=monitor-window.js.map