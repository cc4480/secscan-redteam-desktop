/**
 * Harness2 probe verdict assembly + the durable verdict log (spec section 8).
 *
 * Every probe verdict is appended as one JSON line to
 *   <DSH_HARNESS2_ROOT>/verdicts.jsonl   (resolveHarness2Paths().root)
 * The line carries, for BOTH sides, all six section-8 metrics (SR, VF, FPR,
 * STEPS, TOK, CR), the composite S and its delta, the five gate conditions, the
 * held-out/leakage facts, the tokens spent and the token budget the probe was
 * allowed. The file is append-only: it is the audit trail, so a verdict is
 * never rewritten or silently dropped (a refused probe is logged too).
 *
 * The returned ProbeVerdictResult is a contract.ProbeVerdict (so the P3
 * adoption flow keeps working unchanged) plus the section-8 detail. `adopted`
 * is true only when the gate says ADOPT AND the operator passed explicit
 * approval; the gate verdict alone never installs or activates anything.
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Harness2Paths, ProbeVerdict, RunMetrics, TrajectoryRecord } from "./contract.js";
import { bundleFromRecord, type Harness2Store, type RunBundle } from "./store.js";
import {
  round,
  type GateCondition,
  type GateResult,
  type MetricSet,
  type VerdictName,
} from "./scoring.js";

/** Verdict log file name under paths.root. */
export const VERDICTS_FILE = "verdicts.jsonl";

/** Default cap on tokens one probe may spend; recorded even when not reached. */
export const DEFAULT_TOKEN_BUDGET = 2_000_000;

/** Everything the log needs to explain a verdict later. */
export interface VerdictLogRecord {
  readonly recordedAt: string;
  readonly proposalId: string;
  readonly targetClass: string;
  readonly verdict: VerdictName;
  readonly adopted: boolean;
  readonly reason: string;
  readonly base: MetricSet;
  readonly candidate: MetricSet;
  readonly composite: GateResult["score"];
  readonly conditions: readonly GateCondition[];
  readonly heldOut: {
    readonly targets: readonly string[];
    readonly n: number;
    readonly trainingTargets: number;
    readonly overlaps: readonly string[];
    readonly disjoint: boolean;
  };
  readonly tokensSpent: number;
  readonly tokenBudget: number;
  readonly baseRuns: number;
  readonly candidateRuns: number;
}

/** A contract verdict plus the section-8 evidence behind it. */
export interface ProbeVerdictResult extends ProbeVerdict {
  readonly verdict: VerdictName;
  readonly base: MetricSet;
  readonly candidate: MetricSet;
  readonly composite: GateResult["score"];
  readonly conditions: readonly GateCondition[];
  readonly tokenBudget: number;
}

/** The all-zero metric set for a probe that was refused before any run. */
export function emptyMetrics(): MetricSet {
  return { n: 0, successes: 0, claimsTotal: 0, falsePositives: 0, crashed: 0, sr: 0, vf: 0, fpr: 0, steps: 0, tok: 0, cr: 0 };
}

/** Contract deltas; positive is always better. Section 5 keeps one token total. */
export function buildDeltas(base: MetricSet, candidate: MetricSet): ProbeVerdict["deltas"] {
  return {
    vulnsFound: round(candidate.vf - base.vf),
    falsePositives: round(base.fpr - candidate.fpr),
    steps: round(base.steps - candidate.steps),
    tokensIn: round(base.tok - candidate.tok),
    tokensOut: 0,
  };
}

/** A verdict for a probe refused before measuring (logged, never omitted). */
export function insufficientVerdict(input: {
  readonly proposalId: string;
  readonly reason: string;
  readonly tokensSpent?: number;
  readonly tokenBudget?: number;
}): ProbeVerdictResult {
  const metrics = emptyMetrics();
  return {
    proposalId: input.proposalId,
    adopted: false,
    deltas: buildDeltas(metrics, metrics),
    baseRuns: 0,
    candidateRuns: 0,
    reason: `insufficient-data: ${input.reason}`,
    tokensSpent: input.tokensSpent ?? 0,
    verdict: "INSUFFICIENT_DATA",
    base: metrics,
    candidate: metrics,
    composite: { base: 0, candidate: 0, delta: 0 },
    conditions: [],
    tokenBudget: input.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
  };
}

export interface AssembleVerdictInput {
  readonly proposalId: string;
  readonly targetClass: string;
  readonly base: MetricSet;
  readonly candidate: MetricSet;
  readonly gate: GateResult;
  readonly heldOut: VerdictLogRecord["heldOut"];
  readonly approve: boolean;
  readonly tokensSpent: number;
  readonly tokenBudget: number;
  readonly baseRuns: number;
  readonly candidateRuns: number;
  readonly recordedAt: string;
}

function reasonOf(gate: GateResult, approve: boolean): string {
  if (gate.verdict === "INSUFFICIENT_DATA") {
    const first = gate.conditions.find((condition) => !condition.passed);
    return `insufficient-data: ${first === undefined ? "no measurable evaluation" : first.detail}`;
  }
  if (gate.verdict === "REJECT") {
    const failed = gate.conditions.filter((condition) => !condition.passed).map((condition) => condition.name);
    return `rejected: ${failed.join("; ")}`;
  }
  const detail = `all five section-8 gate conditions hold (S ${gate.score.base} -> ${gate.score.candidate}, delta ${gate.score.delta})`;
  return approve ? `adopted: ${detail}` : "approval required";
}

/** Assemble the contract verdict + section-8 evidence from a gate result. */
export function assembleVerdict(input: AssembleVerdictInput): ProbeVerdictResult {
  const adopted = input.gate.verdict === "ADOPT" && input.approve;
  return {
    proposalId: input.proposalId,
    adopted,
    deltas: buildDeltas(input.base, input.candidate),
    baseRuns: input.baseRuns,
    candidateRuns: input.candidateRuns,
    reason: reasonOf(input.gate, input.approve),
    tokensSpent: input.tokensSpent,
    verdict: input.gate.verdict,
    base: input.base,
    candidate: input.candidate,
    composite: input.gate.score,
    conditions: input.gate.conditions,
    tokenBudget: input.tokenBudget,
  };
}

/** The append-only verdict log path for this harness2 root. */
export function verdictsPath(paths: Harness2Paths): string {
  return join(paths.root, VERDICTS_FILE);
}

/** Append one verdict line; creates the root lazily. Returns the log path. */
export function appendVerdictLog(paths: Harness2Paths, record: VerdictLogRecord): string {
  mkdirSync(paths.root, { recursive: true });
  const path = verdictsPath(paths);
  appendFileSync(path, `${JSON.stringify(record)}\n`);
  return path;
}

/** Build the log record from an assembled verdict. */
export function verdictLogRecord(
  verdict: ProbeVerdictResult,
  input: { readonly targetClass: string; readonly heldOut: VerdictLogRecord["heldOut"]; readonly recordedAt: string },
): VerdictLogRecord {
  return {
    recordedAt: input.recordedAt,
    proposalId: verdict.proposalId,
    targetClass: input.targetClass,
    verdict: verdict.verdict,
    adopted: verdict.adopted,
    reason: verdict.reason,
    base: verdict.base,
    candidate: verdict.candidate,
    composite: verdict.composite,
    conditions: verdict.conditions,
    heldOut: input.heldOut,
    tokensSpent: verdict.tokensSpent,
    tokenBudget: verdict.tokenBudget,
    baseRuns: verdict.baseRuns,
    candidateRuns: verdict.candidateRuns,
  };
}

/** The full probe evidence (verdict + every run) written under paths.runs. */
export interface ProbeReport {
  readonly verdict: ProbeVerdictResult;
  readonly recordedAt: string;
  readonly targetsFile: string;
  readonly baseLayerIds: readonly string[];
  readonly candidateLayerIds: readonly string[];
  readonly runs: readonly unknown[];
}

/** Write paths.runs/<proposalId>/probe.json atomically; returns the path. */
export function writeProbeReport(paths: Harness2Paths, report: ProbeReport): string {
  const dir = join(paths.runs, report.verdict.proposalId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "probe.json");
  const tmp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    writeFileSync(tmp, JSON.stringify(report, null, 2));
    try {
      renameSync(tmp, path);
    } catch {
      rmSync(path, { force: true });
      renameSync(tmp, path);
    }
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { force: true });
  }
  return path;
}

/** Cap on stored runs scanned to reconstruct the proposal's training targets. */
export const TRAINING_SCAN_LIMIT = 10000;
/**
 * cycle_ref stamp on probe runs. Probe runs are evaluation evidence, never the
 * proposal's training trajectories, so trainingTargets() ignores them; without
 * this a probe's own held-out hosts would read as leakage on the next probe.
 */
export const PROBE_CYCLE_REF = "harness2-probe";

/**
 * Every target in the proposal's trajectories: the class's stored run targets,
 * excluding probe runs (PROBE_CYCLE_REF). This is the leakage reference.
 */
export function trainingTargets(store: Harness2Store, targetClass: string): string[] {
  const rows = store.listRuns({ targetClass, limit: TRAINING_SCAN_LIMIT });
  return rows
    .filter((row) => row.cycleRef !== PROBE_CYCLE_REF)
    .map((row) => row.targetId ?? "")
    .filter((target) => target.trim() !== "");
}

/** Where a probe run happened: its fresh engagement id, target, class and mounted layers. */
export interface ProbeRunStamp {
  readonly runId: string;
  readonly target: string;
  readonly targetClass: string;
  readonly layerIds: readonly string[];
}

/** Ingest one measured probe run into the section-5 store, stamped with what ran. */
export function ingestProbeRun(store: Harness2Store, stamp: ProbeRunStamp, metrics: RunMetrics): void {
  const record: TrajectoryRecord = {
    metrics: { ...metrics, runId: stamp.runId, engagementId: stamp.target, targetClass: stamp.targetClass },
    events: [],
  };
  const bundle: RunBundle = { ...bundleFromRecord(record), targetId: stamp.target, targetClass: stamp.targetClass, cycleRef: PROBE_CYCLE_REF };
  store.upsertRows({ ...bundle, layerSet: stamp.layerIds }, []);
}

