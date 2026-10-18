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
import type { LlmTokenUsage } from "./trajectory-normalize.js";

/** File name inside the engagement directory. */
export const STEPS_FILE_NAME = "steps.jsonl";

/** The three captured roles; mirrors the section-5 `steps.role` CHECK. */
export type StepRole = "prompt" | "tool" | "observation";

/** Prefix on an observation row whose tool dispatch threw. */
export const TOOL_ERROR_PREFIX = "ERROR: ";

/** One section-5 `steps` row. */
export interface StepRecord {
  readonly run_id: string;
  readonly seq: number;
  readonly ts: string;
  readonly role: StepRole;
  readonly tool_name: string | null;
  readonly content: string;
  readonly tokens: number | null;
}

/** The append-only journal for one engagement. */
export interface StepJournal {
  /** Absolute path of steps.jsonl, or "" when the journal is a no-op. */
  readonly path: string;
  readonly runId: string;
  /** Records in the file (existing lines + appended this process). */
  readonly count: number;
  /** Sum of the per-response tokens recorded on prompt rows. */
  readonly tokensTotal: number;
  append(role: StepRole, toolName: string | null, content: string, tokens: number | null): StepRecord | null;
  prompt(content: string, tokens?: number | null): void;
  tool(toolName: string, content: string): void;
  observation(toolName: string, content: string, tokens?: number | null): void;
}

/** Redact PII and known secret literals before anything reaches disk. */
export function redactStepContent(content: string): string {
  return redact(redactPii(content));
}

/** Path of the step journal for an engagement directory. */
export function stepsPath(engagementDir: string): string {
  return join(engagementDir, STEPS_FILE_NAME);
}

function countExistingLines(path: string): number {
  if (!existsSync(path)) return 0;
  try {
    return readFileSync(path, "utf8").split("\n").filter((line) => line.trim() !== "").length;
  } catch {
    return 0;
  }
}

/**
 * Create the journal for one engagement directory. `dir` undefined yields a
 * no-op journal (a unit-test Ctx has no engagement dir; nothing is written).
 */
export function createStepJournal(options: { readonly dir?: string; readonly runId: string }): StepJournal {
  const dir = options.dir;
  const path = dir === undefined ? "" : stepsPath(dir);
  let seq = dir === undefined ? 0 : countExistingLines(path);
  let tokensTotal = 0;
  let ensured = false;
  const append: StepJournal["append"] = (role, toolName, content, tokens) => {
    if (dir === undefined) return null;
    try {
      if (!ensured) {
        mkdirSync(dir, { recursive: true });
        ensured = true;
      }
      const record: StepRecord = {
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
      if (record.tokens !== null) tokensTotal += record.tokens;
      return record;
    } catch {
      // Observability must never break a run or mask a halt.
      return null;
    }
  };
  return {
    path,
    runId: options.runId,
    get count(): number {
      return seq;
    },
    get tokensTotal(): number {
      return tokensTotal;
    },
    append,
    prompt(content: string, tokens?: number | null): void {
      append("prompt", null, content, tokens ?? null);
    },
    tool(toolName: string, content: string): void {
      append("tool", toolName, content, null);
    },
    observation(toolName: string, content: string, tokens?: number | null): void {
      append("observation", toolName, content, tokens ?? null);
    },
  };
}

/**
 * Per-engagement journals, keyed by the run's Ctx so two concurrent
 * engagements in one process never share a seq counter.
 */
const journalsByEngagement = new WeakMap<object, StepJournal>();

function journalLocation(owner: object): { dir?: string; runId: string } {
  const events = (owner as { events?: { dir?: unknown; engagementId?: unknown } }).events;
  const dir = typeof events?.dir === "string" && events.dir !== "" ? events.dir : undefined;
  if (dir === undefined) return { runId: "unknown" };
  const runId = typeof events?.engagementId === "string" && events.engagementId !== "" ? events.engagementId : basename(dir);
  return { dir, runId };
}

/** The step journal for one engagement context; created on first use. */
export function stepJournalFor(owner: object): StepJournal {
  const existing = journalsByEngagement.get(owner);
  if (existing !== undefined) return existing;
  const journal = createStepJournal(journalLocation(owner));
  journalsByEngagement.set(owner, journal);
  return journal;
}

/** Total tokens (prompt + completion) of one provider response, or null. */
export function responseTokens(usage: LlmTokenUsage | undefined): number | null {
  if (usage === undefined) return null;
  if (typeof usage.totalTokens === "number" && Number.isFinite(usage.totalTokens)) {
    return Math.max(0, Math.trunc(usage.totalTokens));
  }
  const sum = (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
  return Number.isFinite(sum) ? Math.max(0, Math.trunc(sum)) : null;
}

/** Read back a step journal, skipping corrupt lines. Never throws. */
export function readSteps(engagementDir: string): StepRecord[] {
  const path = stepsPath(engagementDir);
  if (!existsSync(path)) return [];
  let body: string;
  try {
    body = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const records: StepRecord[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const raw = JSON.parse(trimmed) as Partial<StepRecord>;
      if (typeof raw.seq !== "number" || !Number.isFinite(raw.seq) || typeof raw.content !== "string") continue;
      if (raw.role !== "prompt" && raw.role !== "tool" && raw.role !== "observation") continue;
      records.push({
        run_id: typeof raw.run_id === "string" ? raw.run_id : "",
        seq: Math.trunc(raw.seq),
        ts: typeof raw.ts === "string" ? raw.ts : "",
        role: raw.role,
        tool_name: typeof raw.tool_name === "string" ? raw.tool_name : null,
        content: raw.content,
        tokens: typeof raw.tokens === "number" && Number.isFinite(raw.tokens) ? Math.trunc(raw.tokens) : null,
      });
    } catch {
      // Skip a half-written line; the rest of the journal stays usable.
    }
  }
  return records;
}

/** Observations whose dispatch threw (the tool-error signal for failure_mode). */
export function countStepErrors(steps: readonly StepRecord[]): number {
  return steps.filter((step) => step.role === "observation" && step.content.startsWith(TOOL_ERROR_PREFIX)).length;
}

/** Sum of the per-response tokens recorded in a step journal. */
export function sumStepTokens(steps: readonly StepRecord[]): number {
  return steps.reduce((sum, step) => sum + (step.tokens ?? 0), 0);
}
