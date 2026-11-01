/**
 * Q-RP-11 — the host-inventory artifact contract (report side).
 *
 * A local-host engagement (EngagementInput.localHost) collects the host's
 * posture ON-HOST during recon and writes ONE artifact into the engagement
 * dir: host-inventory.json. This module is the report phase's half of that
 * contract: the shape, a fail-loud parser, the dir reader, and the count
 * reconciliation. The collector (host-exec territory) writes the artifact;
 * nothing here collects anything.
 *
 * Honesty rules: no artifact => no inventory section; a `failed` artifact
 * renders the failure, never fabricated rows; an empty required row array
 * (volumes, accounts, patches, software) means that block was NOT
 * collected — the renderer says "Not collected", never a measured zero.
 * Printed counts derive from the row arrays; the collector's recorded
 * totals ride alongside and a disagreement renders as a reconciliation
 * note. The sensitive-data block carries presence and counts only — the
 * parser drops non-contract fields, so contents cannot be smuggled in.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v) => typeof v === "string";
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
function reqStr(o, key, where) {
    const v = o[key];
    if (!isStr(v) || v === "")
        throw new Error(`host-inventory: ${where}.${key} must be a non-empty string`);
    return v;
}
function optStr(o, key) {
    return isStr(o[key]) ? o[key] : undefined;
}
function reqNum(o, key, where) {
    const v = o[key];
    if (!isNum(v))
        throw new Error(`host-inventory: ${where}.${key} must be a number`);
    return v;
}
function rows(v, where) {
    if (!Array.isArray(v))
        throw new Error(`host-inventory: ${where} must be an array`);
    return v.map((r, i) => {
        if (!isObj(r))
            throw new Error(`host-inventory: ${where}[${i}] must be an object`);
        return { label: reqStr(r, "label", `${where}[${i}]`), value: reqStr(r, "value", `${where}[${i}]`) };
    });
}
function optRows(o, key) {
    return o[key] === undefined ? undefined : rows(o[key], key);
}
function parseFilesystem(v) {
    if (!isObj(v))
        throw new Error("host-inventory: filesystem must be an object");
    const sized = (key) => {
        const arr = v[key];
        if (!Array.isArray(arr))
            throw new Error(`host-inventory: filesystem.${key} must be an array`);
        return arr.map((r, i) => {
            if (!isObj(r))
                throw new Error(`host-inventory: filesystem.${key}[${i}] must be an object`);
            return { path: reqStr(r, "path", `filesystem.${key}[${i}]`), bytes: reqNum(r, "bytes", `filesystem.${key}[${i}]`) };
        });
    };
    const counted = (key, nameKey) => {
        const arr = v[key];
        if (!Array.isArray(arr))
            throw new Error(`host-inventory: filesystem.${key} must be an array`);
        return arr.map((r, i) => {
            if (!isObj(r))
                throw new Error(`host-inventory: filesystem.${key}[${i}] must be an object`);
            return { [nameKey]: reqStr(r, nameKey, `filesystem.${key}[${i}]`), files: reqNum(r, "files", `filesystem.${key}[${i}]`), bytes: reqNum(r, "bytes", `filesystem.${key}[${i}]`) };
        });
    };
    const totals = counted("totalsByVolume", "volume");
    const categories = counted("categories", "category");
    const recent = v["recentExecutables"];
    if (!Array.isArray(recent))
        throw new Error("host-inventory: filesystem.recentExecutables must be an array");
    return {
        totalsByVolume: totals,
        categories,
        largestDirectories: sized("largestDirectories"),
        largestFiles: sized("largestFiles"),
        recentExecutables: recent.map((r, i) => {
            if (!isObj(r))
                throw new Error(`host-inventory: filesystem.recentExecutables[${i}] must be an object`);
            return { path: reqStr(r, "path", `filesystem.recentExecutables[${i}]`), modifiedAt: reqStr(r, "modifiedAt", `filesystem.recentExecutables[${i}]`) };
        }),
        ...(optStr(v, "coverage") ? { coverage: optStr(v, "coverage") } : {}),
    };
}
function parseSensitive(v) {
    if (!isObj(v))
        throw new Error("host-inventory: sensitive must be an object");
    const cats = v["categories"];
    if (!Array.isArray(cats))
        throw new Error("host-inventory: sensitive.categories must be an array");
    const locs = v["credentialLocations"];
    if (!Array.isArray(locs))
        throw new Error("host-inventory: sensitive.credentialLocations must be an array");
    const stores = v["stores"];
    if (!Array.isArray(stores))
        throw new Error("host-inventory: sensitive.stores must be an array");
    return {
        categories: cats.map((r, i) => {
            if (!isObj(r))
                throw new Error(`host-inventory: sensitive.categories[${i}] must be an object`);
            return { category: reqStr(r, "category", `sensitive.categories[${i}]`), files: reqNum(r, "files", `sensitive.categories[${i}]`) };
        }),
        credentialLocations: locs.map((r, i) => {
            if (!isObj(r))
                throw new Error(`host-inventory: sensitive.credentialLocations[${i}] must be an object`);
            if (typeof r["present"] !== "boolean")
                throw new Error(`host-inventory: sensitive.credentialLocations[${i}].present must be a boolean`);
            return {
                location: reqStr(r, "location", `sensitive.credentialLocations[${i}]`),
                present: r["present"],
                ...(optStr(r, "note") ? { note: optStr(r, "note") } : {}),
            };
        }),
        stores: stores.map((r, i) => {
            if (!isObj(r))
                throw new Error(`host-inventory: sensitive.stores[${i}] must be an object`);
            return { store: reqStr(r, "store", `sensitive.stores[${i}]`), entries: reqNum(r, "entries", `sensitive.stores[${i}]`) };
        }),
    };
}
/** Parse + validate a host-inventory.json value. Throws on any contract
 * violation — the caller degrades to the `failed` form, never guesses. */
export function parseHostInventory(raw) {
    if (!isObj(raw))
        throw new Error("host-inventory: artifact must be an object");
    if (raw["status"] === "failed") {
        return {
            status: "failed",
            error: reqStr(raw, "error", "artifact"),
            ...(optStr(raw, "hostname") ? { hostname: optStr(raw, "hostname") } : {}),
            ...(optStr(raw, "collectedAt") ? { collectedAt: optStr(raw, "collectedAt") } : {}),
        };
    }
    if (raw["status"] !== "ok")
        throw new Error('host-inventory: artifact.status must be "ok" or "failed"');
    const inv = raw["inventory"];
    if (!isObj(inv))
        throw new Error("host-inventory: artifact.inventory must be an object");
    const list = (key, parse) => {
        const arr = inv[key];
        if (!Array.isArray(arr))
            throw new Error(`host-inventory: inventory.${key} must be an array`);
        return arr.map((r, i) => {
            if (!isObj(r))
                throw new Error(`host-inventory: inventory.${key}[${i}] must be an object`);
            return parse(r, i);
        });
    };
    const totalsRaw = inv["totals"];
    if (!isObj(totalsRaw))
        throw new Error("host-inventory: inventory.totals must be an object");
    const inventory = {
        hostname: reqStr(inv, "hostname", "inventory"),
        collectedAt: reqStr(inv, "collectedAt", "inventory"),
        collector: reqStr(inv, "collector", "inventory"),
        system: rows(inv["system"], "inventory.system"),
        volumes: list("volumes", (r, i) => ({
            name: reqStr(r, "name", `volumes[${i}]`),
            ...(optStr(r, "fileSystem") ? { fileSystem: optStr(r, "fileSystem") } : {}),
            ...(isNum(r["sizeBytes"]) ? { sizeBytes: r["sizeBytes"] } : {}),
            ...(isNum(r["freeBytes"]) ? { freeBytes: r["freeBytes"] } : {}),
        })),
        accounts: list("accounts", (r, i) => ({
            name: reqStr(r, "name", `accounts[${i}]`),
            kind: reqStr(r, "kind", `accounts[${i}]`),
            ...(typeof r["enabled"] === "boolean" ? { enabled: r["enabled"] } : {}),
            ...(Array.isArray(r["groups"]) ? { groups: r["groups"].filter(isStr) } : {}),
        })),
        patches: list("patches", (r, i) => ({
            id: reqStr(r, "id", `patches[${i}]`),
            ...(optStr(r, "installedOn") ? { installedOn: optStr(r, "installedOn") } : {}),
        })),
        ...(optStr(inv, "patchLevel") ? { patchLevel: optStr(inv, "patchLevel") } : {}),
        ...(inv["processes"] !== undefined ? {
            processes: list("processes", (r, i) => ({
                name: reqStr(r, "name", `processes[${i}]`),
                ...(isNum(r["pid"]) ? { pid: r["pid"] } : {}),
                ...(optStr(r, "user") ? { user: optStr(r, "user") } : {}),
                ...(isNum(r["cpuPercent"]) ? { cpuPercent: r["cpuPercent"] } : {}),
                ...(isNum(r["memoryPercent"]) ? { memoryPercent: r["memoryPercent"] } : {}),
            })),
        } : {}),
        ...(optRows(inv, "defender") ? { defender: optRows(inv, "defender") } : {}),
        ...(optRows(inv, "remoteConfig") ? { remoteConfig: optRows(inv, "remoteConfig") } : {}),
        ...(optRows(inv, "hardening") ? { hardening: optRows(inv, "hardening") } : {}),
        software: list("software", (r, i) => ({
            name: reqStr(r, "name", `software[${i}]`),
            ...(optStr(r, "version") ? { version: optStr(r, "version") } : {}),
            ...(optStr(r, "publisher") ? { publisher: optStr(r, "publisher") } : {}),
        })),
        ...(inv["filesystem"] !== undefined ? { filesystem: parseFilesystem(inv["filesystem"]) } : {}),
        ...(inv["sensitive"] !== undefined ? { sensitive: parseSensitive(inv["sensitive"]) } : {}),
        totals: {
            volumes: reqNum(totalsRaw, "volumes", "totals"),
            accounts: reqNum(totalsRaw, "accounts", "totals"),
            patches: reqNum(totalsRaw, "patches", "totals"),
            software: reqNum(totalsRaw, "software", "totals"),
            files: reqNum(totalsRaw, "files", "totals"),
        },
    };
    return { status: "ok", inventory };
}
/** Counts derived from the row arrays — what the section prints. */
export function derivedTotals(inv) {
    return {
        volumes: inv.volumes.length,
        accounts: inv.accounts.length,
        patches: inv.patches.length,
        software: inv.software.length,
        files: inv.filesystem ? inv.filesystem.totalsByVolume.reduce((n, t) => n + t.files, 0) : 0,
    };
}
/** Recorded vs derived, field by field; empty when they agree. */
export function reconcileInventory(inv) {
    const derived = derivedTotals(inv);
    const out = [];
    for (const key of Object.keys(derived)) {
        if (derived[key] !== inv.totals[key]) {
            out.push(`${key}: collector recorded ${inv.totals[key]}, inventory rows carry ${derived[key]}`);
        }
    }
    return out;
}
/**
 * Read the artifact from an engagement dir. Absent file => undefined (the
 * engagement is not a local collection, or collection never ran — either
 * way the report renders no inventory section). A present-but-broken
 * artifact degrades to the `failed` form so the report says so.
 */
export function readHostInventory(dir) {
    const path = join(dir, "host-inventory.json");
    if (!existsSync(path))
        return undefined;
    try {
        return parseHostInventory(JSON.parse(readFileSync(path, "utf8")));
    }
    catch (err) {
        return { status: "failed", error: `host-inventory.json unreadable: ${err.message}` };
    }
}
//# sourceMappingURL=host-inventory.js.map