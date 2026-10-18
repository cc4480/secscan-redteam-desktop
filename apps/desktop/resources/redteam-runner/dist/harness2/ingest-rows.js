/**
 * Harness2 ingest rows (H2-P1, spec section 5): the two section-5 artifacts an
 * H2-P1a capture writes next to trajectory.json/metrics.json.
 *
 *  - `steps.jsonl`: one JSON object per line, appended live during the run:
 *      {"run_id", "seq", "ts", "role": "prompt"|"tool"|"observation",
 *       "tool_name": string|null, "content": FULL text, "tokens": number|null}
 *    The store assigns steps.seq from file order (the journal is contiguous by
 *    contract), so a resumed/rewritten journal still lands in the right order.
 *  - `run.json`: `{ run: {...runs columns...}, metrics: {...metrics columns...} }`
 *    already in section-5 shape, using the exact snake_case column names.
 *
 * Both readers are tolerant: a corrupt line is skipped and counted, a payload
 * that cannot describe a run is reported so ingest falls back to the contract
 * metrics written by H2-P1a. Nothing here throws on bad content.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { readJson } from "./ingest-parse.js";
import { asStepRole, runBundleFromJson } from "./store-rows.js";
export const STEP_ARTIFACT = "steps.jsonl";
export const RUN_ARTIFACT = "run.json";
/** Read `run.json`; null when absent or unusable (the caller falls back). */
export function readRunBundle(path, warnings) {
    const raw = readJson(path, warnings);
    if (raw === undefined)
        return null;
    const bundle = runBundleFromJson(raw);
    if (bundle === null)
        warnings.push(`${basename(path)}: no run_id, falling back to the contract metrics`);
    return bundle;
}
function asStep(raw) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
        return null;
    const record = raw;
    const role = asStepRole(record["role"]);
    const content = record["content"];
    if (role === undefined || typeof content !== "string")
        return null;
    const toolName = record["tool_name"];
    const tokens = record["tokens"];
    return {
        role,
        ...(typeof toolName === "string" && toolName !== "" ? { toolName } : {}),
        content,
        ...(typeof tokens === "number" && Number.isFinite(tokens) ? { tokens: Math.trunc(tokens) } : {}),
    };
}
/** steps.jsonl: one JSON object per line; corrupt lines are skipped and counted. */
export function readStepsJournal(path, warnings) {
    if (!existsSync(path))
        return [];
    const steps = [];
    let corrupt = 0;
    for (const line of readFileSync(path, "utf8").replace(/^\uFEFF/, "").split("\n")) {
        const trimmed = line.trim();
        if (trimmed === "")
            continue;
        try {
            const step = asStep(JSON.parse(trimmed));
            if (step === null)
                corrupt++;
            else
                steps.push(step);
        }
        catch {
            corrupt++;
        }
    }
    if (corrupt > 0)
        warnings.push(`${basename(path)}: skipped ${corrupt} corrupt line(s)`);
    return steps;
}
//# sourceMappingURL=ingest-rows.js.map