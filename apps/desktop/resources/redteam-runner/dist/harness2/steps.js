/**
 * Harness2 section-5 full-text step journal (H2-P1).
 *
 * One append-only `<engagementDir>/steps.jsonl` per run: one JSON object per
 * line, written LIVE from agents.ts agentLoop as the model path executes. The
 * journal is the only artifact that carries the verbatim prompt / tool /
 * observation text - events.jsonl keeps its existing 300/800-char projections
 * and is not touched.
 *
 * Record shape (snake_case matches the section-5 `steps` columns exactly):
 *   { run_id, seq, ts, role: "prompt" | "tool" | "observation",
 *     tool_name: string | null, content: string, tokens: number | null }
 *
 * Capture rules:
 *  - role=prompt: content is the FULL outgoing ChatMessage[] (system + user +
 *    accumulated history) serialized as JSON; tokens is the total usage of the
 *    model response that prompt produced (ChatResult.usage), or null when the
 *    call failed before a response existed.
 *  - role=tool: content is the FULL JSON arguments of the tool call.
 *  - role=observation: content is the FULL tool result, or "ERROR: <message>"
 *    when the dispatch threw (the caller rethrows immediately after).
 *  - content is NEVER truncated. It is passed through the existing redaction
 *    (PII patterns + the audit log's secret-literal mask) before it reaches
 *    disk, because reasoning/tool output can echo secrets.
 *
 * Fail-soft by design: this is observability next to a live engagement, so no
 * append may throw into the run - an unwritable journal degrades to a no-op
 * with count 0 rather than masking a halt.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { redact } from "../events/redact.js";
import { redactPii } from "../safety/index.js";
/** File name inside the engagement directory. */
export const STEPS_FILE_NAME = "steps.jsonl";
/** Prefix on an observation row whose tool dispatch threw. */
export const TOOL_ERROR_PREFIX = "ERROR: ";
/** Redact PII and known secret literals before anything reaches disk. */
export function redactStepContent(content) {
    return redact(redactPii(content));
}
/** Path of the step journal for an engagement directory. */
export function stepsPath(engagementDir) {
    return join(engagementDir, STEPS_FILE_NAME);
}
function countExistingLines(path) {
    if (!existsSync(path))
        return 0;
    try {
        return readFileSync(path, "utf8").split("\n").filter((line) => line.trim() !== "").length;
    }
    catch {
        return 0;
    }
}
/**
 * Create the journal for one engagement directory. `dir` undefined yields a
 * no-op journal (a unit-test Ctx has no engagement dir; nothing is written).
 */
export function createStepJournal(options) {
    const dir = options.dir;
    const path = dir === undefined ? "" : stepsPath(dir);
    let seq = dir === undefined ? 0 : countExistingLines(path);
    let tokensTotal = 0;
    let ensured = false;
    const append = (role, toolName, content, tokens) => {
        if (dir === undefined)
            return null;
        try {
            if (!ensured) {
                mkdirSync(dir, { recursive: true });
                ensured = true;
            }
            const record = {
                run_id: options.runId,
                seq: seq + 1,
                ts: new Date().toISOString(),
                role,
                tool_name: toolName ?? null,
                content: redactStepContent(content),
                tokens: tokens ?? null,
            };
            appendFileSync(path, JSON.stringify(record) + "\n");
            seq = record.seq;
            if (record.tokens !== null)
                tokensTotal += record.tokens;
            return record;
        }
        catch {
            // Observability must never break a run or mask a halt.
            return null;
        }
    };
    return {
        path,
        runId: options.runId,
        get count() {
            return seq;
        },
        get tokensTotal() {
            return tokensTotal;
        },
        append,
        prompt(content, tokens) {
            append("prompt", null, content, tokens ?? null);
        },
        tool(toolName, content) {
            append("tool", toolName, content, null);
        },
        observation(toolName, content, tokens) {
            append("observation", toolName, content, tokens ?? null);
        },
    };
}
/**
 * Per-engagement journals, keyed by the run's Ctx so two concurrent
 * engagements in one process never share a seq counter.
 */
const journalsByEngagement = new WeakMap();
function journalLocation(owner) {
    const events = owner.events;
    const dir = typeof events?.dir === "string" && events.dir !== "" ? events.dir : undefined;
    if (dir === undefined)
        return { runId: "unknown" };
    const runId = typeof events?.engagementId === "string" && events.engagementId !== "" ? events.engagementId : basename(dir);
    return { dir, runId };
}
/** The step journal for one engagement context; created on first use. */
export function stepJournalFor(owner) {
    const existing = journalsByEngagement.get(owner);
    if (existing !== undefined)
        return existing;
    const journal = createStepJournal(journalLocation(owner));
    journalsByEngagement.set(owner, journal);
    return journal;
}
/** Total tokens (prompt + completion) of one provider response, or null. */
export function responseTokens(usage) {
    if (usage === undefined)
        return null;
    if (typeof usage.totalTokens === "number" && Number.isFinite(usage.totalTokens)) {
        return Math.max(0, Math.trunc(usage.totalTokens));
    }
    const sum = (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
    return Number.isFinite(sum) ? Math.max(0, Math.trunc(sum)) : null;
}
/** Read back a step journal, skipping corrupt lines. Never throws. */
export function readSteps(engagementDir) {
    const path = stepsPath(engagementDir);
    if (!existsSync(path))
        return [];
    let body;
    try {
        body = readFileSync(path, "utf8");
    }
    catch {
        return [];
    }
    const records = [];
    for (const line of body.split("\n")) {
        const trimmed = line.trim();
        if (trimmed === "")
            continue;
        try {
            const raw = JSON.parse(trimmed);
            if (typeof raw.seq !== "number" || !Number.isFinite(raw.seq) || typeof raw.content !== "string")
                continue;
            if (raw.role !== "prompt" && raw.role !== "tool" && raw.role !== "observation")
                continue;
            records.push({
                run_id: typeof raw.run_id === "string" ? raw.run_id : "",
                seq: Math.trunc(raw.seq),
                ts: typeof raw.ts === "string" ? raw.ts : "",
                role: raw.role,
                tool_name: typeof raw.tool_name === "string" ? raw.tool_name : null,
                content: raw.content,
                tokens: typeof raw.tokens === "number" && Number.isFinite(raw.tokens) ? Math.trunc(raw.tokens) : null,
            });
        }
        catch {
            // Skip a half-written line; the rest of the journal stays usable.
        }
    }
    return records;
}
/** Observations whose dispatch threw (the tool-error signal for failure_mode). */
export function countStepErrors(steps) {
    return steps.filter((step) => step.role === "observation" && step.content.startsWith(TOOL_ERROR_PREFIX)).length;
}
/** Sum of the per-response tokens recorded in a step journal. */
export function sumStepTokens(steps) {
    return steps.reduce((sum, step) => sum + (step.tokens ?? 0), 0);
}
//# sourceMappingURL=steps.js.map