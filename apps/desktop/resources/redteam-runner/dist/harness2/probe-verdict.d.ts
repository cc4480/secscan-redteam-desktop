import type { Harness2Paths, ProbeVerdict, RunMetrics } from "./contract.js";
import { type Harness2Store } from "./store.js";
import { type GateCondition, type GateResult, type MetricSet, type VerdictName } from "./scoring.js";
/** Verdict log file name under paths.root. */
export declare const VERDICTS_FILE = "verdicts.jsonl";
/** Default cap on tokens one probe may spend; recorded even when not reached. */
export declare const DEFAULT_TOKEN_BUDGET = 2000000;
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
export declare function emptyMetrics(): MetricSet;
/** Contract deltas; positive is always better. Section 5 keeps one token total. */
export declare function buildDeltas(base: MetricSet, candidate: MetricSet): ProbeVerdict["deltas"];
/** A verdict for a probe refused before measuring (logged, never omitted). */
export declare function insufficientVerdict(input: {
    readonly proposalId: string;
    readonly reason: string;
    readonly tokensSpent?: number;
    readonly tokenBudget?: number;
}): ProbeVerdictResult;
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
/** Assemble the contract verdict + section-8 evidence from a gate result. */
export declare function assembleVerdict(input: AssembleVerdictInput): ProbeVerdictResult;
/** The append-only verdict log path for this harness2 root. */
export declare function verdictsPath(paths: Harness2Paths): string;
/** Append one verdict line; creates the root lazily. Returns the log path. */
export declare function appendVerdictLog(paths: Harness2Paths, record: VerdictLogRecord): string;
/** Build the log record from an assembled verdict. */
export declare function verdictLogRecord(verdict: ProbeVerdictResult, input: {
    readonly targetClass: string;
    readonly heldOut: VerdictLogRecord["heldOut"];
    readonly recordedAt: string;
}): VerdictLogRecord;
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
export declare function writeProbeReport(paths: Harness2Paths, report: ProbeReport): string;
/** Cap on stored runs scanned to reconstruct the proposal's training targets. */
export declare const TRAINING_SCAN_LIMIT = 10000;
/**
 * cycle_ref stamp on probe runs. Probe runs are evaluation evidence, never the
 * proposal's training trajectories, so trainingTargets() ignores them; without
 * this a probe's own held-out hosts would read as leakage on the next probe.
 */
export declare const PROBE_CYCLE_REF = "harness2-probe";
/**
 * Every target in the proposal's trajectories: the class's stored run targets,
 * excluding probe runs (PROBE_CYCLE_REF). This is the leakage reference.
 */
export declare function trainingTargets(store: Harness2Store, targetClass: string): string[];
/** Where a probe run happened: its fresh engagement id, target, class and mounted layers. */
export interface ProbeRunStamp {
    readonly runId: string;
    readonly target: string;
    readonly targetClass: string;
    readonly layerIds: readonly string[];
}
/** Ingest one measured probe run into the section-5 store, stamped with what ran. */
export declare function ingestProbeRun(store: Harness2Store, stamp: ProbeRunStamp, metrics: RunMetrics): void;
