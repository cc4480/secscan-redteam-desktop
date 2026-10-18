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
import { bundleFromRecord } from "./store.js";
import { round, } from "./scoring.js";
/** Verdict log file name under paths.root. */
export const VERDICTS_FILE = "verdicts.jsonl";
/** Default cap on tokens one probe may spend; recorded even when not reached. */
export const DEFAULT_TOKEN_BUDGET = 2_000_000;
/** The all-zero metric set for a probe that was refused before any run. */
export function emptyMetrics() {
    return { n: 0, successes: 0, claimsTotal: 0, falsePositives: 0, crashed: 0, sr: 0, vf: 0, fpr: 0, steps: 0, tok: 0, cr: 0 };
}
/** Contract deltas; positive is always better. Section 5 keeps one token total. */
export function buildDeltas(base, candidate) {
    return {
        vulnsFound: round(candidate.vf - base.vf),
        falsePositives: round(base.fpr - candidate.fpr),
        steps: round(base.steps - candidate.steps),
        tokensIn: round(base.tok - candidate.tok),
        tokensOut: 0,
    };
}
/** A verdict for a probe refused before measuring (logged, never omitted). */
export function insufficientVerdict(input) {
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
function reasonOf(gate, approve) {
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
export function assembleVerdict(input) {
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
export function verdictsPath(paths) {
    return join(paths.root, VERDICTS_FILE);
}
/** Append one verdict line; creates the root lazily. Returns the log path. */
export function appendVerdictLog(paths, record) {
    mkdirSync(paths.root, { recursive: true });
    const path = verdictsPath(paths);
    appendFileSync(path, `${JSON.stringify(record)}\n`);
    return path;
}
/** Build the log record from an assembled verdict. */
export function verdictLogRecord(verdict, input) {
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
/** Write paths.runs/<proposalId>/probe.json atomically; returns the path. */
export function writeProbeReport(paths, report) {
    const dir = join(paths.runs, report.verdict.proposalId);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "probe.json");
    const tmp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`;
    try {
        writeFileSync(tmp, JSON.stringify(report, null, 2));
        try {
            renameSync(tmp, path);
        }
        catch {
            rmSync(path, { force: true });
            renameSync(tmp, path);
        }
    }
    finally {
        if (existsSync(tmp))
            rmSync(tmp, { force: true });
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
export function trainingTargets(store, targetClass) {
    const rows = store.listRuns({ targetClass, limit: TRAINING_SCAN_LIMIT });
    return rows
        .filter((row) => row.cycleRef !== PROBE_CYCLE_REF)
        .map((row) => row.targetId ?? "")
        .filter((target) => target.trim() !== "");
}
/** Ingest one measured probe run into the section-5 store, stamped with what ran. */
export function ingestProbeRun(store, stamp, metrics) {
    const record = {
        metrics: { ...metrics, runId: stamp.runId, engagementId: stamp.target, targetClass: stamp.targetClass },
        events: [],
    };
    const bundle = { ...bundleFromRecord(record), targetId: stamp.target, targetClass: stamp.targetClass, cycleRef: PROBE_CYCLE_REF };
    store.upsertRows({ ...bundle, layerSet: stamp.layerIds }, []);
}
//# sourceMappingURL=probe-verdict.js.map