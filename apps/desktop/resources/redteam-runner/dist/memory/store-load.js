/**
 * Store state loading and manifest validation, extracted from `store.ts`
 * to keep that module inside the 300-line file budget. Moved verbatim:
 * the manifest seal/validate rules, JSONL ledger parsing, the strict
 * load path and the views-index consistency check. Behaviour unchanged.
 */
import { existsSync, readFileSync } from "node:fs";
import { MemoryError } from "./errors.js";
import { directoryKey } from "./paths.js";
import { aggregateHashes, hashRecord, parseUnitLine } from "./schema.js";
import { readViewsIndex } from "./views.js";
export function manifestHash(manifest) {
    return hashRecord(manifest);
}
export function sealManifest(manifest) {
    return { ...manifest, hash: manifestHash(manifest) };
}
export function validateManifest(raw, path) {
    const rec = (typeof raw === "object" && raw !== null ? raw : {});
    const bad = (detail) => new MemoryError("STORE_CORRUPT", `${path}: manifest ${detail}`);
    if (rec.version !== 1)
        throw bad(`has unsupported version ${JSON.stringify(rec.version)}`);
    if (typeof rec.storeId !== "string" || !rec.storeId)
        throw bad("is missing storeId");
    if (typeof rec.createdAt !== "string" || !Number.isFinite(Date.parse(rec.createdAt)))
        throw bad("has a bad createdAt");
    for (const field of ["unitCount", "versionCount", "commitCount"]) {
        if (!Number.isInteger(rec[field]) || rec[field] < 0)
            throw bad(`has a bad ${field}`);
    }
    if (typeof rec.archiveSeqByEngagement !== "object" || rec.archiveSeqByEngagement === null) {
        throw bad("has a bad archiveSeqByEngagement");
    }
    const manifest = raw;
    const { hash, ...rest } = manifest;
    if (hash !== manifestHash(rest))
        throw bad("hash mismatch (manifest was altered after sealing)");
    return manifest;
}
/** Split a JSONL file's content into lines; a torn final line stays a line and fails parsing downstream. */
function ledgerLines(content) {
    if (content === "")
        return [];
    const lines = content.split("\n");
    if (lines[lines.length - 1] === "")
        lines.pop();
    return lines;
}
export function loadStore(paths, opts = {}) {
    if (!existsSync(paths.manifestPath)) {
        throw new MemoryError("STORE_CORRUPT", `${paths.manifestPath}: manifest missing in an existing store root`);
    }
    let manifest;
    try {
        manifest = validateManifest(JSON.parse(readFileSync(paths.manifestPath, "utf8")), paths.manifestPath);
    }
    catch (err) {
        if (err instanceof MemoryError)
            throw err;
        throw new MemoryError("STORE_CORRUPT", `${paths.manifestPath}: manifest unparseable`, { cause: err });
    }
    if (!existsSync(paths.unitsPath)) {
        throw new MemoryError("STORE_CORRUPT", `${paths.unitsPath}: unit ledger missing in an existing store`);
    }
    const current = new Map();
    const seenVersions = new Set();
    const unitLines = ledgerLines(readFileSync(paths.unitsPath, "utf8"));
    for (const [i, line] of unitLines.entries()) {
        const unit = parseUnitLine(line, i + 1, paths.unitsPath);
        const versionKey = `${unit.unitId}@${unit.version}`;
        if (seenVersions.has(versionKey)) {
            throw new MemoryError("STORE_CORRUPT", `${paths.unitsPath}:${i + 1}: duplicate version line for ${versionKey}`);
        }
        seenVersions.add(versionKey);
        const existing = current.get(unit.unitId);
        if (!existing || unit.version > existing.version)
            current.set(unit.unitId, unit);
    }
    const statuses = new Map();
    let commitCount = 0;
    if (!existsSync(paths.commitsPath)) {
        throw new MemoryError("STORE_CORRUPT", `${paths.commitsPath}: status overlay missing in an existing store`);
    }
    const commitLines = ledgerLines(readFileSync(paths.commitsPath, "utf8"));
    for (const [i, line] of commitLines.entries()) {
        let parsed;
        try {
            parsed = JSON.parse(line);
        }
        catch (err) {
            throw new MemoryError("STORE_CORRUPT", `${paths.commitsPath}:${i + 1}: invalid JSON`, { cause: err });
        }
        if (typeof parsed.unitId !== "string" ||
            !Number.isInteger(parsed.version) ||
            !["active", "proposed", "superseded", "retired"].includes(parsed.status) ||
            typeof parsed.at !== "string" ||
            typeof parsed.by !== "string" ||
            typeof parsed.reason !== "string") {
            throw new MemoryError("STORE_CORRUPT", `${paths.commitsPath}:${i + 1}: malformed status line`);
        }
        statuses.set(parsed.unitId, parsed);
        commitCount += 1;
    }
    if (manifest.unitCount !== current.size || manifest.versionCount !== unitLines.length || manifest.commitCount !== commitCount) {
        throw new MemoryError("STORE_CORRUPT", `${paths.manifestPath}: manifest counts (units ${manifest.unitCount}, versions ${manifest.versionCount}, commits ${manifest.commitCount}) ` +
            `disagree with the ledger (units ${current.size}, versions ${unitLines.length}, commits ${commitCount})`);
    }
    if (!opts.skipIndexCheck)
        validateViewsIndex(paths, current, statuses);
    return { manifest, current, statuses, versionCount: unitLines.length, commitCount };
}
/** §8 row 4: the views index must agree with the ledger, or open fails. */
function validateViewsIndex(paths, current, statuses) {
    if (!existsSync(paths.viewsIndexPath)) {
        throw new MemoryError("STORE_INDEX_MISMATCH", `${paths.viewsIndexPath}: views index missing (repair: memory reindex)`);
    }
    const index = readViewsIndex(paths);
    const activeByDir = new Map();
    for (const unit of current.values()) {
        if ((statuses.get(unit.unitId)?.status ?? "active") !== "active")
            continue;
        const key = directoryKey(unit.scope);
        activeByDir.set(key, [...(activeByDir.get(key) ?? []), unit]);
    }
    for (const [dir, units] of activeByDir) {
        const entry = index.dirs[dir];
        if (!entry) {
            throw new MemoryError("STORE_INDEX_MISMATCH", `views.json has no entry for ${dir} (repair: memory reindex)`);
        }
        const aggregate = aggregateHashes(units.map((u) => u.hash));
        if (entry.totalUnits !== units.length || entry.sourceHashAggregate !== aggregate) {
            throw new MemoryError("STORE_INDEX_MISMATCH", `views.json entry for ${dir} disagrees with the ledger (repair: memory reindex)`);
        }
    }
    for (const [dir, entry] of Object.entries(index.dirs)) {
        if (!activeByDir.has(dir) && entry.totalUnits !== 0) {
            throw new MemoryError("STORE_INDEX_MISMATCH", `views.json entry for ${dir} claims ${entry.totalUnits} units the ledger does not hold (repair: memory reindex)`);
        }
    }
}
//# sourceMappingURL=store-load.js.map