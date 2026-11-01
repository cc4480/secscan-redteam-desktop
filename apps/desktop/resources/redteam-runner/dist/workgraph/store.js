/**
 * Work-graph persistence: workgraph.json in the engagement dir, written
 * atomically (tmp file + rename) after every transition, so a killed
 * process never leaves a torn graph and a restart can resume from the
 * last settled state. One engagement's graph is held per Ctx (WeakMap)
 * while the engagement runs.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export const FLOW_FILE = "workgraph.json";
export function flowPath(dir) {
    return join(dir, FLOW_FILE);
}
/** Persist the graph atomically; returns the path written. */
export function saveFlow(dir, flow) {
    const path = flowPath(dir);
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(flow, null, 1)}\n`);
    renameSync(tmp, path);
    return path;
}
/** Load and validate a persisted graph, or null when absent/corrupt. */
export function loadFlow(dir) {
    const path = flowPath(dir);
    if (!existsSync(path))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (parsed.version !== 1 || typeof parsed.engagementId !== "string" || !Array.isArray(parsed.tasks)) {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
const perEngagement = new WeakMap();
/** Attach the live graph to this engagement context. */
export function attachFlow(ctx, flow) {
    perEngagement.set(ctx, flow);
}
/** The live graph for this engagement, when one is attached. */
export function flowFor(ctx) {
    return perEngagement.get(ctx) ?? null;
}
//# sourceMappingURL=store.js.map