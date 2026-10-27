/**
 * Duplicate-call guard (PentAGI alignment A1).
 *
 * PentAGI's performer fingerprints tool calls and blocks repeats; this
 * runner had no equivalent, so a stuck agent could re-fire the identical
 * probe for the whole engagement. The guard lives at the dispatch choke
 * point and covers the calls that generate target traffic — exactly the
 * calls that carry a target host at dispatch (the rate-limited family).
 * State-dependent tools (bookkeeping, registry reads, MCP) are out of
 * scope: their correct result can change between identical calls.
 *
 * Semantics, per role + phase, keyed to the engagement's Ctx:
 * - A call identical to one that already completed cleanly is refused
 *   immediately; the refusal carries a digest of the previous result so
 *   the agent keeps the information without the traffic.
 * - A call identical to one that already failed twice is refused from
 *   the third attempt; one retry of a failed call stays legal (a
 *   transient network failure must not wedge a target).
 * - Refusals are DENIED-prefixed results, so the agent loop's existing
 *   wall detection and turn-integrity treat them as no-progress, and
 *   each refusal is written to the engagement event log — never silent.
 */
import { createHash } from "node:crypto";
import { type ActorRole, type EngagementPhase } from "../types.js";
import { type Ctx } from "../context.js";
import { type ToolCallRequest } from "@secscan/redteam-llm-router";
import { type DispatchResult } from "./types.js";

interface GuardEntry {
  /** Result text of the first clean execution (capped), once one exists. */
  cleanResult?: string;
  /** How many identical calls have failed without a clean execution. */
  failures: number;
  /** Most recent failure text (capped), quoted in the refusal digest. */
  lastFailure?: string;
}

/** Per-engagement guard state, keyed by the engagement's Ctx object. */
const seen = new WeakMap<Ctx, Map<string, GuardEntry>>();

function mapFor(ctx: Ctx): Map<string, GuardEntry> {
  let m = seen.get(ctx);
  if (!m) {
    m = new Map();
    seen.set(ctx, m);
  }
  return m;
}

/** Stable JSON for argument values: object keys sorted, arrays in order. */
function canonical(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec).filter((k) => rec[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(rec[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Identity of a call itself: tool name + canonical arguments, hashed. */
export function toolCallKey(call: ToolCallRequest): string {
  return createHash("sha256")
    .update(`${call.name}\n${canonical(call.arguments ?? {})}`)
    .digest("hex");
}

function fingerprint(role: ActorRole, phase: EngagementPhase, call: ToolCallRequest): string {
  return `${role}|${phase}|${toolCallKey(call)}`;
}

/** The dispatcher's own clean-result heuristic, mirrored from router.ts. */
function isClean(d: DispatchResult): boolean {
  return d.ok === undefined
    ? !/^(DENIED|HALTED)/i.test(d.result) && !d.result.startsWith("probe failed")
    : d.ok;
}

/**
 * Refusal for an identical repeat call, or undefined when the call may
 * execute. Only calls carrying a target host are guarded; `host`
 * undefined means the tool generates no target traffic.
 */
export function duplicateRefusal(
  ctx: Ctx,
  role: ActorRole,
  phase: EngagementPhase,
  call: ToolCallRequest,
  host: string | undefined,
): DispatchResult | undefined {
  if (!host) return undefined;
  const entry = mapFor(ctx).get(fingerprint(role, phase, call));
  if (!entry) return undefined;
  let result: string;
  if (entry.cleanResult !== undefined) {
    result =
      `DENIED: duplicate call refused — ${call.name} with identical arguments already ` +
      `completed in this ${phase} phase; repeating it sends the same traffic for no new ` +
      `information. Vary the probe or move on. Previous result digest: ${entry.cleanResult.slice(0, 500)}`;
  } else if (entry.failures >= 2) {
    result =
      `DENIED: duplicate call refused — ${call.name} with identical arguments already ` +
      `failed ${entry.failures} times in this ${phase} phase. Change the probe, the ` +
      `target, or the approach. Last failure digest: ${(entry.lastFailure ?? "").slice(0, 300)}`;
  } else {
    return undefined;
  }
  ctx.events.append({ phase, actor: "runner", action: "duplicate_refused", target: host, result });
  return { result, target: host, ok: false };
}

/**
 * Record an executed call's outcome so a later identical call can be
 * refused. Called only for calls that actually executed (post-hooks
 * result); gate denials never reach it and never seed the guard.
 */
export function recordCallOutcome(
  ctx: Ctx,
  role: ActorRole,
  phase: EngagementPhase,
  call: ToolCallRequest,
  host: string | undefined,
  d: DispatchResult,
): void {
  if (!host) return;
  const map = mapFor(ctx);
  const key = fingerprint(role, phase, call);
  const entry = map.get(key) ?? { failures: 0 };
  if (isClean(d)) {
    entry.cleanResult = d.result.slice(0, 4000);
  } else {
    entry.failures++;
    entry.lastFailure = d.result.slice(0, 1000);
  }
  map.set(key, entry);
}
