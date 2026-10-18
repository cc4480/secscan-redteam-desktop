/**
 * Harness2 ingest parsing (H2-P1b): tolerant readers for the artifacts a run
 * directory can contain.
 *
 * H2-P1a writes trajectory.json and metrics.json alongside the files the runner
 * already produces. Runs recorded before it only have events.jsonl,
 * engagement.md and state.json, and a crashed run can leave any artifact
 * half-written, so every reader here degrades instead of throwing: a bad file
 * becomes a warning and the next source is tried.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import type { HarnessStamp, RunMetrics, RunOutcome, TrajectoryEvent } from "./contract.js";

const OUTCOMES: readonly RunOutcome[] = ["success", "partial", "failure", "aborted"];
/** Actions that are tool invocations, for legacy logs that never recorded the flag. */
const TOOL_ACTION = /^(scan_|probe_|http_|nmap_|nuclei_|msf_|ssh_|winrm_|smb_|rdp_|ffuf_|gobuster_|nikto_|sqlmap_|john_|xtool_|browser_)/;

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function integer(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function asOutcome(value: unknown): RunOutcome {
  return typeof value === "string" && OUTCOMES.includes(value as RunOutcome) ? (value as RunOutcome) : "partial";
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function stringsRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObject(value)) return out;
  for (const [key, entry] of Object.entries(value)) if (typeof entry === "string") out[key] = entry;
  return out;
}

/** Read a text artifact, dropping a UTF-8 BOM if an editor added one. */
function readText(path: string): string {
  return readFileSync(path, "utf8").replace(/^\uFEFF/, "");
}

/** Parse a JSON file; a missing file is silent, a corrupt one becomes a warning. */
export function readJson(path: string, warnings: string[]): unknown {
  if (!existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readText(path));
    return parsed;
  } catch (err) {
    warnings.push(`${basename(path)} unreadable: ${(err as Error).message}`);
    return undefined;
  }
}

/** Parse a JSON object file, discarding non-object payloads. */
export function readObject(path: string, warnings: string[]): Record<string, unknown> | undefined {
  const raw = readJson(path, warnings);
  return isObject(raw) ? raw : undefined;
}

/** Parse a JSON object file without recording warnings (used for fast freshness checks). */
export function readObjectQuiet(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const raw: unknown = JSON.parse(readText(path));
    return isObject(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

function inferToolCall(action: string, attackId: string | undefined): boolean {
  return attackId !== undefined || TOOL_ACTION.test(action);
}

/** Normalize a trajectory.json/metrics.json payload into the contract's RunMetrics. */
export function asMetrics(raw: unknown): RunMetrics | null {
  if (!isObject(raw)) return null;
  const inner = isObject(raw.metrics) ? raw.metrics : raw;
  const runId = text(inner.runId);
  if (runId === undefined) return null;
  const harness = isObject(inner.harness) ? inner.harness : {};
  const stamp: HarnessStamp = {
    runnerVersion: text(harness.runnerVersion) ?? "unknown",
    commit: text(harness.commit),
    layerIds: strings(harness.layerIds),
    componentHashes: stringsRecord(harness.componentHashes),
  };
  return {
    runId,
    engagementId: text(inner.engagementId) ?? runId,
    targetClass: text(inner.targetClass) ?? "unknown",
    outcome: asOutcome(inner.outcome),
    vulnsFound: integer(inner.vulnsFound),
    falsePositives: integer(inner.falsePositives),
    exploitsSucceeded: integer(inner.exploitsSucceeded),
    exploitsAttempted: integer(inner.exploitsAttempted),
    steps: integer(inner.steps),
    tokensIn: integer(inner.tokensIn),
    tokensOut: integer(inner.tokensOut),
    durationMs: integer(inner.durationMs),
    harness: stamp,
    startedAt: text(inner.startedAt) ?? "",
    finishedAt: text(inner.finishedAt) ?? "",
  };
}

function asEvent(raw: unknown): TrajectoryEvent | null {
  if (!isObject(raw)) return null;
  const action = text(raw.action);
  if (action === undefined) return null;
  const attackId = text(raw.attackId);
  const flagged = raw.isToolCall;
  return {
    ts: text(raw.ts) ?? "",
    phase: text(raw.phase) ?? "unknown",
    actor: text(raw.actor) ?? "runner",
    action,
    attackId,
    target: text(raw.target),
    result: text(raw.result) ?? "",
    isToolCall: typeof flagged === "boolean" ? flagged : inferToolCall(action, attackId),
  };
}

export function asEvents(raw: unknown): TrajectoryEvent[] {
  if (!Array.isArray(raw)) return [];
  const events: TrajectoryEvent[] = [];
  for (const entry of raw) {
    const event = asEvent(entry);
    if (event !== null) events.push(event);
  }
  return events;
}

/** events.jsonl: one JSON object per line; corrupt lines are skipped and counted. */
export function readEventsJsonl(path: string, warnings: string[]): TrajectoryEvent[] {
  if (!existsSync(path)) return [];
  const events: TrajectoryEvent[] = [];
  let corrupt = 0;
  for (const line of readText(path).split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const event = asEvent(parsed);
      if (event === null) corrupt++;
      else events.push(event);
    } catch {
      corrupt++;
    }
  }
  if (corrupt > 0) warnings.push(`events.jsonl: skipped ${corrupt} corrupt line(s)`);
  return events;
}

/** engagement.md fallback: the runner's `| ts | phase | actor | action | result |` table. */
export function readEngagementMd(path: string, warnings: string[]): TrajectoryEvent[] {
  if (!existsSync(path)) return [];
  const events: TrajectoryEvent[] = [];
  for (const line of readText(path).split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 5) continue;
    const ts = cells[0] ?? "";
    const phase = cells[1] ?? "";
    const actor = cells[2] ?? "";
    const actionCell = cells[3] ?? "";
    if (ts === "" || ts === "Time" || ts.startsWith("---")) continue;
    const attackMatch = /\((T\d+(?:\.\d+)?)\)\s*$/.exec(actionCell);
    const action = actionCell.replace(/\s*\(T\d+(?:\.\d+)?\)\s*$/, "").trim();
    if (action === "") continue;
    const attackId = attackMatch?.[1];
    events.push({
      ts,
      phase: phase === "" ? "unknown" : phase,
      actor: actor === "" ? "runner" : actor,
      action,
      attackId,
      result: cells.slice(4).join(" | "),
      isToolCall: inferToolCall(action, attackId),
    });
  }
  if (events.length === 0) warnings.push("engagement.md: no parsable table rows");
  return events;
}

/** Host class from a target string, e.g. "https://shop.example.test:443/x" -> "shop.example.test". */
function targetClassOf(target: string): string {
  const bare = target.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const host = (bare.split(/[/?#]/)[0] ?? "").replace(/:\d+$/, "").toLowerCase();
  if (host === "") return "unknown";
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? "host" : host;
}

function durationBetween(startedAt: string, finishedAt: string): number {
  const start = Date.parse(startedAt);
  const end = Date.parse(finishedAt);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

/** Metrics for a legacy run: honest zeroes where only the event log survives. */
export function deriveMetrics(
  engagementId: string,
  state: Record<string, unknown> | undefined,
  events: readonly TrajectoryEvent[],
): RunMetrics {
  const findings = Array.isArray(state?.["findings"]) ? state["findings"].length : 0;
  const status = text(state?.["status"]) ?? "unknown";
  const outcome: RunOutcome =
    status === "complete" ? "success" : status === "halted" ? "aborted" : status === "blocked" ? "failure" : "partial";
  const startedAt = text(state?.["startedAt"]) ?? "";
  const finishedAt = text(state?.["updatedAt"]) ?? startedAt;
  return {
    runId: engagementId,
    engagementId,
    targetClass: targetClassOf(text(state?.["target"]) ?? ""),
    outcome,
    vulnsFound: findings,
    falsePositives: 0,
    exploitsSucceeded: 0,
    exploitsAttempted: events.filter((event) => event.isToolCall).length,
    steps: 0,
    tokensIn: 0,
    tokensOut: 0,
    durationMs: durationBetween(startedAt, finishedAt),
    harness: { runnerVersion: "unknown", layerIds: [], componentHashes: {} },
    startedAt,
    finishedAt,
  };
}
