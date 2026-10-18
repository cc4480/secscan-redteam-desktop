/**
 * Harness2 offline probe harness (H2-P2b).
 *
 * The probe measures a PROPOSED layer offline: it never runs per task and never
 * touches production on its own. It is on-demand (a CLI command a person types)
 * and takes its targets only from an EXPLICIT probe-targets JSON file - a JSON
 * list of engagement inputs. With no file it refuses to run at all.
 *
 * ADOPTION RULE (documented, mechanical; candidate = the proposed k=1 layer):
 *   - Each side (base layer set, candidate layer set) runs the SAME probe
 *     targets N times (default and minimum N = 2) on the SAME executor (the
 *     injected runEngagement seam - the CLI wires the real runner, so a probe
 *     uses whatever model/provider that environment uses, e.g. the local Qwen).
 *     Every run is a fresh engagement with a fresh engagement id.
 *   - Compare mean RunMetrics. Primary metric = vulnsFound (higher better).
 *     Only if it ties: falsePositives (lower better), then steps (lower better).
 *     The first metric that differs decides.
 *   - Consistency: the deciding metric must not move the wrong way on ANY probe
 *     target (a win on one target may not pay for a regression on another).
 *   - N < 2 runs per side is discarded before spending anything: one run cannot
 *     adopt a layer.
 *   - Better + explicit `approve: true` => adopted: true. Better without
 *     approval => adopted: false, reason exactly "approval required". Worse,
 *     inconsistent or tied => adopted: false with the measurement as the reason.
 *   - tokensSpent is always recorded (sum of tokensIn+tokensOut over every run).
 *
 * The probe does NOT install the layer into the active composition and does NOT
 * append EXPERIENCE lessons: P3's adoptVerdict is the only adoption path. The
 * candidate is staged in the layer store only for the duration of the probe (so
 * a layer-mounting seam can read it by id) and is removed afterwards.
 *
 * The runner seam lives in ./probe-cli.ts (`createRunnerProbeSeam`), including
 * the exact runner integration point a real layer mount needs.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EngagementInput } from "../types.js";
import {
  PINNED_COMPONENT,
  type Harness2Paths,
  type PatchLayer,
  type ProbeVerdict,
  type Proposal,
  type RunMetrics,
} from "./contract.js";
import { activeLayerIds, assertLayerGuardrails, composeActiveLayers, installLayer, removeLayer } from "./layers.js";
import { decideProbe, discardedVerdict, meanOf, round, type RunSample } from "./probe-verdict.js";

export { decideProbe } from "./probe-verdict.js";
export type { ProbeDecision, RunSample } from "./probe-verdict.js";

export type ProbeSide = "base" | "candidate";

/** One probe target: the engagement input from the targets file, plus a class hint. */
export interface ProbeTarget extends EngagementInput {
  readonly targetClass?: string;
}

/** What the seam receives for one run: a fresh engagement per run. */
export interface ProbeRunInput extends ProbeTarget {
  readonly engagementId: string;
  readonly side: ProbeSide;
  readonly runIndex: number;
}

/** The injectable executor seam: run one fresh engagement with these layers, return its measured metrics. */
export type ProbeRunFn = (input: ProbeRunInput, layerIds: readonly string[]) => Promise<RunMetrics>;

/** Minimum runs per side: a single lucky run can never adopt a layer. */
export const MIN_RUNS_PER_SIDE = 2;
/** Cap on targets in one probe file, so a typo cannot fan out over a fleet. */
export const MAX_PROBE_TARGETS = 20;

function refuse(message: string): never {
  throw new Error(`[harness2] probe refused: ${message}`);
}

// ---------------------------------------------------------------------------
// The safety gate: an explicit targets file, or nothing runs
// ---------------------------------------------------------------------------

function validateTarget(entry: unknown, index: number): ProbeTarget {
  const label = `probe target #${index + 1}`;
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) refuse(`${label} is not an object`);
  const raw = entry as Record<string, unknown>;
  const target = raw["target"];
  if (typeof target !== "string" || target.trim() === "") refuse(`${label} has no "target"`);
  if (raw["mode"] !== undefined && raw["mode"] !== "red" && raw["mode"] !== "black") refuse(`${label} mode must be red|black`);
  const objective = raw["objective"];
  if (objective !== undefined && (typeof objective !== "string" || objective.trim() === "")) refuse(`${label} objective is empty`);
  const roe = raw["roe"];
  const scope = roe !== null && typeof roe === "object" ? (roe as Record<string, unknown>)["scope"] : undefined;
  if (!Array.isArray(scope) || scope.length === 0 || !scope.every((host) => typeof host === "string" && host.trim() !== "")) {
    refuse(`${label} needs roe.scope as a non-empty list of exact hosts`);
  }
  if (raw["targetClass"] !== undefined && (typeof raw["targetClass"] !== "string" || raw["targetClass"].trim() === "")) {
    refuse(`${label} targetClass is empty`);
  }
  return raw as unknown as ProbeTarget;
}

/**
 * Load the explicit probe-targets file. Missing path, missing file, invalid
 * JSON, an empty list or more than MAX_PROBE_TARGETS entries all refuse to run:
 * there is no default target and no "discover some targets first" mode.
 */
export function loadProbeTargets(targetsFile: string | undefined): ProbeTarget[] {
  if (targetsFile === undefined || targetsFile.trim() === "") {
    refuse("an explicit probe-targets file is required (--targets <file.json>); the probe never picks its own targets");
  }
  if (!existsSync(targetsFile)) refuse(`probe-targets file not found: ${targetsFile}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(targetsFile, "utf8")) as unknown;
  } catch (err) {
    refuse(`probe-targets file is not valid JSON: ${targetsFile} (${(err as Error).message})`);
  }
  if (!Array.isArray(raw)) refuse(`probe-targets file must be a JSON list of engagement inputs: ${targetsFile}`);
  if (raw.length === 0) refuse(`probe-targets file lists no targets: ${targetsFile}`);
  if (raw.length > MAX_PROBE_TARGETS) refuse(`probe-targets file lists ${raw.length} targets; the cap is ${MAX_PROBE_TARGETS}`);
  return raw.map((entry, index) => validateTarget(entry, index));
}

// ---------------------------------------------------------------------------
// The probe
// ---------------------------------------------------------------------------

export interface ProbeRunSummary {
  readonly engagementId: string;
  readonly side: ProbeSide;
  readonly targetIndex: number;
  readonly runIndex: number;
  readonly metrics: RunMetrics;
}

export interface ProbeProposalInput {
  readonly paths: Harness2Paths
  readonly proposal: Proposal
  /** Explicit probe-targets file; undefined refuses the probe. */
  readonly targetsFile: string | undefined
  /** The injectable executor seam: (input, layerIds) => RunMetrics. */
  readonly runEngagement: ProbeRunFn
  /**
   * Capability check for the layer set the candidate run needs. The real runner
   * seam refuses a non-empty set until a layer can actually be mounted (see
   * createRunnerProbeSeam); tests/fakes may omit it.
   */
  readonly assertLayersMountable?: (layerIds: readonly string[]) => void
  /** Runs per side per target. Default and minimum MIN_RUNS_PER_SIDE. */
  readonly runsPerSide?: number
  /** Explicit operator approval. Absent => propose-only: adopted is always false. */
  readonly approve?: boolean
  /** Clock seam (tests). */
  readonly now?: () => Date
}

export interface ProbeReport {
  readonly verdict: ProbeVerdict
  readonly recordedAt: string
  readonly targetsFile: string
  readonly baseLayerIds: readonly string[]
  readonly candidateLayerIds: readonly string[]
  readonly runs: readonly ProbeRunSummary[]
}

function assertMetrics(metrics: RunMetrics, engagementId: string): RunMetrics {
  for (const key of ["vulnsFound", "falsePositives", "steps", "tokensIn", "tokensOut"] as const) {
    const value = metrics[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      refuse(`run ${engagementId} returned no usable "${key}"; unmeasured runs are never compared`);
    }
  }
  return metrics;
}

async function runOne(
  runEngagement: ProbeRunFn,
  target: ProbeTarget,
  side: ProbeSide,
  targetIndex: number,
  runIndex: number,
  layerIds: readonly string[],
): Promise<ProbeRunSummary> {
  const klass = (target.targetClass ?? "target").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40);
  const engagementId = `h2probe-${klass}-${side}-t${targetIndex + 1}-r${runIndex}`;
  const metrics = assertMetrics(await runEngagement({ ...target, engagementId, side, runIndex }, layerIds), engagementId);
  return { engagementId, side, targetIndex, runIndex, metrics };
}

/** Write the full probe evidence (verdict + every run) under paths.runs/<proposalId>/probe.json. */
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

/**
 * Run one k=1 probe of `proposal` and return the verdict. Refuses before any run
 * without an explicit targets file, without a layer-mount capability, or when N
 * is below the minimum. See the module comment for the adoption rule.
 */
export async function probeProposal(input: ProbeProposalInput): Promise<ProbeVerdict> {
  const targets = loadProbeTargets(input.targetsFile);
  const runsPerSide = input.runsPerSide ?? MIN_RUNS_PER_SIDE;
  if (!Number.isInteger(runsPerSide) || runsPerSide < MIN_RUNS_PER_SIDE) {
    return discardedVerdict(
      input.proposal.id,
      `N runs per side must be an integer >= ${MIN_RUNS_PER_SIDE} (got ${String(input.runsPerSide)}); one run cannot adopt a layer`,
    );
  }
  if (input.proposal.component === PINNED_COMPONENT) {
    refuse(`proposal "${input.proposal.id}" targets the pinned guardrails component`);
  }
  const now = input.now?.() ?? new Date();
  const candidate: PatchLayer = {
    id: input.proposal.id,
    ...(input.proposal.targetClass !== "" ? { targetClass: input.proposal.targetClass } : {}),
    yaml: input.proposal.yaml,
    adoptedAt: now.toISOString(),
    evidenceRunId: "probe-pending",
  };
  assertLayerGuardrails(candidate);
  const baseLayerIds = activeLayerIds(input.paths);
  composeActiveLayers(input.paths);
  const candidateLayerIds = [...baseLayerIds, candidate.id];
  input.assertLayersMountable?.(candidateLayerIds);
  const baseRuns: ProbeRunSummary[] = [];
  const candidateRuns: ProbeRunSummary[] = [];
  // The candidate is staged in the layer store only for the candidate runs (so
  // a mounting seam can read it by id) and never before: the base runs must see
  // exactly the base composition. removeLayer only ever deletes what we staged.
  let staged = false;
  try {
    for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
      for (let runIndex = 1; runIndex <= runsPerSide; runIndex++) {
        baseRuns.push(await runOne(input.runEngagement, targets[targetIndex]!, "base", targetIndex, runIndex, baseLayerIds));
      }
    }
    installLayer(input.paths, candidate, { installedAt: now.toISOString() });
    staged = true;
    for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
      for (let runIndex = 1; runIndex <= runsPerSide; runIndex++) {
        candidateRuns.push(
          await runOne(input.runEngagement, targets[targetIndex]!, "candidate", targetIndex, runIndex, candidateLayerIds),
        );
      }
    }
  } finally {
    if (staged) removeLayer(input.paths, candidate.id);
  }
  const baseSamples: RunSample[] = baseRuns.map((run) => ({ targetIndex: run.targetIndex, metrics: run.metrics }));
  const candidateSamples: RunSample[] = candidateRuns.map((run) => ({ targetIndex: run.targetIndex, metrics: run.metrics }));
  const decision = decideProbe(baseSamples, candidateSamples, targets.length);
  const tokensSpent = [...baseRuns, ...candidateRuns].reduce((sum, run) => sum + run.metrics.tokensIn + run.metrics.tokensOut, 0);
  const deltas: ProbeVerdict["deltas"] = {
    vulnsFound: round(meanOf(candidateSamples, "vulnsFound") - meanOf(baseSamples, "vulnsFound")),
    falsePositives: round(meanOf(baseSamples, "falsePositives") - meanOf(candidateSamples, "falsePositives")),
    steps: round(meanOf(baseSamples, "steps") - meanOf(candidateSamples, "steps")),
    tokensIn: round(meanOf(baseSamples, "tokensIn") - meanOf(candidateSamples, "tokensIn")),
    tokensOut: round(meanOf(baseSamples, "tokensOut") - meanOf(candidateSamples, "tokensOut")),
  };
  const adopted = decision.better && input.approve === true;
  const reason = decision.better
    ? input.approve === true
      ? `adopted: ${decision.reason}`
      : "approval required"
    : `discarded: ${decision.reason}`;
  const verdict: ProbeVerdict = {
    proposalId: input.proposal.id,
    adopted,
    deltas,
    baseRuns: baseRuns.length,
    candidateRuns: candidateRuns.length,
    reason,
    tokensSpent,
  };
  writeProbeReport(input.paths, {
    verdict,
    recordedAt: now.toISOString(),
    targetsFile: input.targetsFile ?? "",
    baseLayerIds,
    candidateLayerIds,
    runs: [...baseRuns, ...candidateRuns],
  });
  return verdict;
}
