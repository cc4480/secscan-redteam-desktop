/**
 * Harness2 lifecycle state (H2-P3, spec sections 11.2/11.5): the persisted
 * bookkeeping shared by the lifecycle operations and the auto-rollback monitor.
 *
 * Everything lives under `<paths.root>/lifecycle`:
 *
 *   freeze.json            per-target-class consolidation freeze records. A
 *                          consolidation REJECT/INSUFFICIENT_DATA freezes new
 *                          proposals for that class until an operator clears it.
 *   operator-flags.jsonl   append-only operator attention queue (freezes,
 *                          incidents). The monitor/lifecycle never edit or drop
 *                          a flag; an operator resolves it out of band.
 *   adoptions.json         the adoption registry: for every layer adopted into
 *                          the active set, the at-adoption baseline the monitor
 *                          compares the following 10 runs against.
 *   incidents.jsonl        append-only guardrail-incident log.
 *
 * State is written atomically (tmp + rename) so a crash never leaves a
 * half-written registry; logs are append-only JSONL. Nothing here is ever
 * deleted: a closed adoption keeps its record with a close reason, and flags
 * are never removed.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
/** How many runs after an adoption the monitor watches (spec section 11.5). */
export const MONITOR_WINDOW = 10;
/** `<root>/lifecycle`. */
export function lifecycleDir(paths) {
    return join(paths.root, "lifecycle");
}
export function freezePath(paths) {
    return join(lifecycleDir(paths), "freeze.json");
}
export function flagsPath(paths) {
    return join(lifecycleDir(paths), "operator-flags.jsonl");
}
export function adoptionsPath(paths) {
    return join(lifecycleDir(paths), "adoptions.json");
}
export function incidentsPath(paths) {
    return join(lifecycleDir(paths), "incidents.jsonl");
}
function ensureDir(path) {
    mkdirSync(dirname(path), { recursive: true });
}
/** Tmp-write then rename; the old file is removed first because Windows rename cannot replace. */
function atomicWrite(path, body) {
    ensureDir(path);
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
function readJson(path, fallback) {
    if (!existsSync(path))
        return fallback;
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return fallback;
    }
}
function appendJsonLine(path, record) {
    ensureDir(path);
    appendFileSync(path, `${JSON.stringify(record)}\n`);
}
// ---------------------------------------------------------------------------
// Consolidation freeze
// ---------------------------------------------------------------------------
/** Every freeze currently in force, sorted by target class. */
export function readFreezes(paths) {
    const raw = readJson(freezePath(paths), []);
    if (!Array.isArray(raw))
        return [];
    const records = [];
    for (const entry of raw) {
        if (entry === null || typeof entry !== "object")
            continue;
        const item = entry;
        if (typeof item["targetClass"] !== "string" || typeof item["reason"] !== "string")
            continue;
        records.push({
            targetClass: item["targetClass"],
            reason: item["reason"],
            date: typeof item["date"] === "string" ? item["date"] : "",
            flaggedAt: typeof item["flaggedAt"] === "string" ? item["flaggedAt"] : "",
            verdict: typeof item["verdict"] === "string" ? item["verdict"] : "",
        });
    }
    return records.sort((a, b) => a.targetClass.localeCompare(b.targetClass));
}
/** The class's freeze record, or null when it is not frozen. */
export function readFreeze(paths, targetClass) {
    return readFreezes(paths).find((record) => record.targetClass === targetClass) ?? null;
}
/** True when new proposals for the class are frozen. */
export function isFrozen(paths, targetClass) {
    return readFreeze(paths, targetClass) !== null;
}
/** Freeze a class and flag the operator. Returns the record written. */
export function freezeClass(paths, record) {
    const rest = readFreezes(paths).filter((seen) => seen.targetClass !== record.targetClass);
    atomicWrite(freezePath(paths), JSON.stringify([...rest, record].sort((a, b) => a.targetClass.localeCompare(b.targetClass)), null, 2));
    appendFlag(paths, {
        ts: record.flaggedAt,
        kind: "consolidation-freeze",
        targetClass: record.targetClass,
        detail: `new proposals frozen for "${record.targetClass}": ${record.reason}`,
    });
    return record;
}
/** Remove a class's freeze (an operator decision). Returns true when one existed. */
export function clearFreeze(paths, targetClass) {
    const records = readFreezes(paths);
    const rest = records.filter((record) => record.targetClass !== targetClass);
    if (rest.length === records.length)
        return false;
    atomicWrite(freezePath(paths), JSON.stringify(rest, null, 2));
    return true;
}
// ---------------------------------------------------------------------------
// Operator flags + incidents (append-only)
// ---------------------------------------------------------------------------
/** Record one operator attention flag. */
export function appendFlag(paths, flag) {
    appendJsonLine(flagsPath(paths), flag);
    return flag;
}
/** Every operator flag ever raised (oldest first); unreadable lines are skipped. */
export function readFlags(paths) {
    return readJsonLines(flagsPath(paths));
}
/** Record one guardrail incident. */
export function appendIncident(paths, incident) {
    appendJsonLine(incidentsPath(paths), incident);
    return incident;
}
/** Every incident ever recorded (oldest first). */
export function readIncidents(paths) {
    return readJsonLines(incidentsPath(paths));
}
/** Tolerant JSONL reader: skips unreadable lines, never throws. */
export function readJsonLines(path) {
    if (!existsSync(path))
        return [];
    const records = [];
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
        if (line.trim() === "")
            continue;
        try {
            records.push(JSON.parse(line));
        }
        catch {
            continue;
        }
    }
    return records;
}
// ---------------------------------------------------------------------------
// Adoption registry (the monitor's input)
// ---------------------------------------------------------------------------
/** Every adoption record, oldest first. */
export function readAdoptions(paths) {
    const raw = readJson(adoptionsPath(paths), []);
    if (!Array.isArray(raw))
        return [];
    const records = [];
    for (const entry of raw) {
        if (entry === null || typeof entry !== "object")
            continue;
        const item = entry;
        if (typeof item["layerId"] !== "string" || typeof item["targetClass"] !== "string")
            continue;
        if (typeof item["adoptedAtMs"] !== "number")
            continue;
        records.push({
            layerId: item["layerId"],
            targetClass: item["targetClass"],
            cycleId: typeof item["cycleId"] === "string" ? item["cycleId"] : "",
            adoptedAtMs: item["adoptedAtMs"],
            adoptedAtIso: typeof item["adoptedAtIso"] === "string" ? item["adoptedAtIso"] : new Date(item["adoptedAtMs"]).toISOString(),
            ...(typeof item["sAtAdoption"] === "number" ? { sAtAdoption: item["sAtAdoption"] } : {}),
            ...(typeof item["crAtAdoption"] === "number" ? { crAtAdoption: item["crAtAdoption"] } : {}),
            ...(typeof item["closedAtMs"] === "number" ? { closedAtMs: item["closedAtMs"] } : {}),
            ...(typeof item["closeReason"] === "string" ? { closeReason: item["closeReason"] } : {}),
        });
    }
    return records.sort((a, b) => a.adoptedAtMs - b.adoptedAtMs);
}
/** Register (or replace, by layerId) one adoption for auto-rollback monitoring. */
export function recordAdoption(paths, record) {
    const rest = readAdoptions(paths).filter((seen) => seen.layerId !== record.layerId);
    atomicWrite(adoptionsPath(paths), JSON.stringify([...rest, record], null, 2));
    return record;
}
/** Mark an adoption's monitoring window closed (rollback, incident or window complete). */
export function closeAdoption(paths, layerId, reason, atMs) {
    const records = readAdoptions(paths);
    const index = records.findIndex((record) => record.layerId === layerId);
    if (index === -1)
        return false;
    const current = records[index];
    records[index] = { ...current, closedAtMs: atMs, closeReason: reason };
    atomicWrite(adoptionsPath(paths), JSON.stringify(records, null, 2));
    return true;
}
/** Find one adoption record by layer id. */
export function findAdoption(paths, layerId) {
    return readAdoptions(paths).find((record) => record.layerId === layerId) ?? null;
}
//# sourceMappingURL=lifecycle-state.js.map