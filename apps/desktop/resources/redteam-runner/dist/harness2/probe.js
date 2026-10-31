/**
 * Harness2 offline probe harness (H2-P2, spec section 8).
 *
 * The probe measures a PROPOSED layer offline: on-demand only (a command a
 * person types), never per task, never onto production on its own. Targets come
 * only from an EXPLICIT probe-targets JSON file; with no file nothing runs.
 *
 * EVALUATION (spec section 8):
 *  - The targets file defines the held-out set H. H needs at least
 *    MIN_HELD_OUT_TARGETS (8) DISTINCT targets; with fewer the verdict is
 *    INSUFFICIENT_DATA and no tokens are spent.
 *  - H must be disjoint from every target in the proposal's trajectories, read
 *    from the section-5 store (the class's stored runs). Any overlap is a
 *    REJECT before any run: a leaked held-out set cannot measure a proposal.
 *  - Each side (base, candidate) runs every target runsPerSide times on the SAME
 *    injected executor (the CLI wires the real runner, so a probe uses whatever
 *    model/provider that environment uses); every run is a fresh engagement.
 *    Both sides are reduced to the six section-8 metrics and the five-condition
 *    gate (scoring.ts). ADOPT needs explicit operator approval (`approve: true`)
 *    before anything is installed or activated.
 *  - tokensSpent is summed over every run and a token budget caps the probe:
 *    on exhaustion the probe stops and reports INSUFFICIENT_DATA.
 *  - Every verdict (including a refusal) is appended to verdicts.jsonl under
 *    DSH_HARNESS2_ROOT (see probe-verdict.ts) with all six metrics for base and
 *    candidate, the gate conditions, tokens spent and the budget. Each probe run
 *    is also ingested into the section-5 store.
 *
 * The runner seam lives in ./probe-cli.ts (`createRunnerProbeSeam`). The
 * candidate is staged in the layer store only for the duration of the probe.
 */
import { existsSync, readFileSync } from "node:fs";
import { PINNED_COMPONENT } from "./contract.js";
import { activeLayerIds, assertLayerGuardrails, composeActiveLayers, installLayer, removeLayer } from "./layers.js";
import { computeMetrics, evaluateGate, findLeakage, fromRunMetrics, MIN_HELD_OUT_TARGETS, targetKey } from "./scoring.js";
import { appendVerdictLog, assembleVerdict, DEFAULT_TOKEN_BUDGET, ingestProbeRun, insufficientVerdict, trainingTargets, verdictLogRecord, writeProbeReport, } from "./probe-verdict.js";
export { trainingTargets };
/** Cap on targets in one probe file, so a typo cannot fan out over a fleet. */
export const MAX_PROBE_TARGETS = 20;
/** Default runs of each target per side; one A/B pass is the minimum measurement. */
export const DEFAULT_RUNS_PER_SIDE = 1;
function refuse(message) {
    throw new Error(`[harness2] probe refused: ${message}`);
}
// ---------------------------------------------------------------------------
// The safety gate: an explicit targets file, or nothing runs
// ---------------------------------------------------------------------------
function validateTarget(entry, index) {
    const label = `probe target #${index + 1}`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry))
        refuse(`${label} is not an object`);
    const raw = entry;
    const target = raw["target"];
    if (typeof target !== "string" || target.trim() === "")
        refuse(`${label} has no "target"`);
    if (raw["mode"] !== undefined && raw["mode"] !== "red" && raw["mode"] !== "black")
        refuse(`${label} mode must be red|black`);
    const roe = raw["roe"];
    const scope = roe !== null && typeof roe === "object" ? roe["scope"] : undefined;
    if (!Array.isArray(scope) || scope.length === 0 || !scope.every((host) => typeof host === "string" && host.trim() !== "")) {
        refuse(`${label} needs roe.scope as a non-empty list of exact hosts`);
    }
    if (raw["targetClass"] !== undefined && (typeof raw["targetClass"] !== "string" || raw["targetClass"].trim() === "")) {
        refuse(`${label} targetClass is empty`);
    }
    return raw;
}
/**
 * Load the explicit probe-targets file. Missing path, missing file, invalid
 * JSON, an empty list or more than MAX_PROBE_TARGETS entries all refuse to run:
 * there is no default target and no "discover some targets first" mode.
 */
export function loadProbeTargets(targetsFile) {
    if (targetsFile === undefined || targetsFile.trim() === "") {
        refuse("an explicit probe-targets file is required (--targets <file.json>); the probe never picks its own targets");
    }
    if (!existsSync(targetsFile))
        refuse(`probe-targets file not found: ${targetsFile}`);
    let raw;
    try {
        raw = JSON.parse(readFileSync(targetsFile, "utf8"));
    }
    catch (err) {
        refuse(`probe-targets file is not valid JSON: ${targetsFile} (${err.message})`);
    }
    if (!Array.isArray(raw))
        refuse(`probe-targets file must be a JSON list of engagement inputs: ${targetsFile}`);
    if (raw.length === 0)
        refuse(`probe-targets file lists no targets: ${targetsFile}`);
    if (raw.length > MAX_PROBE_TARGETS)
        refuse(`probe-targets file lists ${raw.length} targets; the cap is ${MAX_PROBE_TARGETS}`);
    return raw.map((entry, index) => validateTarget(entry, index));
}
function assertMetrics(metrics, engagementId) {
    for (const key of ["vulnsFound", "falsePositives", "steps", "tokensIn", "tokensOut"]) {
        if (!Number.isFinite(metrics[key]) || metrics[key] < 0)
            refuse(`run ${engagementId} returned no usable "${key}"; unmeasured runs are never compared`);
    }
    return metrics;
}
async function runOne(runEngagement, target, side, targetIndex, runIndex, layerIds) {
    const klass = (target.targetClass ?? "target").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40);
    const engagementId = `h2probe-${klass}-${side}-t${targetIndex + 1}-r${runIndex}`;
    const metrics = assertMetrics(await runEngagement({ ...target, engagementId, side, targetIndex, runIndex }, layerIds), engagementId);
    return { engagementId, side, targetIndex, runIndex, metrics };
}
/**
 * Run one offline probe of `proposal` and return the section-8 verdict. Refuses
 * before any run without an explicit targets file; reports INSUFFICIENT_DATA
 * before any run for fewer than 8 distinct held-out targets, a store log gap or
 * a leaked held-out set that cannot be measured honestly.
 */
export async function probeProposal(input) {
    const targets = loadProbeTargets(input.targetsFile);
    const runsPerSide = input.runsPerSide ?? DEFAULT_RUNS_PER_SIDE;
    if (!Number.isInteger(runsPerSide) || runsPerSide < 1) {
        return insufficientVerdict({ proposalId: input.proposal.id, reason: `runsPerSide must be an integer >= 1 (got ${String(input.runsPerSide)})`, tokenBudget: input.tokenBudget });
    }
    if (input.proposal.component === PINNED_COMPONENT)
        refuse(`proposal "${input.proposal.id}" targets the pinned guardrails component`);
    const now = input.now?.() ?? new Date();
    const recordedAt = now.toISOString();
    const tokenBudget = input.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
    const targetClass = input.proposal.targetClass;
    const heldOutTargets = targets.map((target) => target.target);
    const distinctHeldOut = new Set(heldOutTargets.map(targetKey).filter((key) => key !== ""));
    const training = trainingTargets(input.store, targetClass);
    const overlaps = findLeakage(heldOutTargets, training);
    const heldOut = {
        targets: heldOutTargets,
        n: distinctHeldOut.size,
        trainingTargets: training.length,
        overlaps,
        disjoint: overlaps.length === 0,
    };
    const record = (verdict, runs, baseLayerIds, candidateLayerIds) => {
        appendVerdictLog(input.paths, verdictLogRecord(verdict, { targetClass, heldOut, recordedAt }));
        writeProbeReport(input.paths, { verdict, recordedAt, targetsFile: input.targetsFile ?? "", baseLayerIds, candidateLayerIds, runs });
        return verdict;
    };
    // Pre-run refusals: never spend tokens on an evaluation that cannot decide.
    if (distinctHeldOut.size < MIN_HELD_OUT_TARGETS) {
        const verdict = insufficientVerdict({ proposalId: input.proposal.id, reason: `${distinctHeldOut.size} distinct held-out target(s); at least ${MIN_HELD_OUT_TARGETS} are required`, tokenBudget });
        return record(verdict, [], [], []);
    }
    if (training.length === 0) {
        const verdict = insufficientVerdict({ proposalId: input.proposal.id, reason: `log gap: no stored runs for class "${targetClass}" to prove held-out disjointness`, tokenBudget });
        return record(verdict, [], [], []);
    }
    if (overlaps.length > 0) {
        const empty = computeMetrics([]);
        const verdict = assembleVerdict({
            proposalId: input.proposal.id,
            targetClass,
            base: empty,
            candidate: empty,
            gate: evaluateGate({ base: empty, candidate: empty, heldOutTargets, trainingTargets: training }),
            heldOut,
            approve: input.approve === true,
            tokensSpent: 0,
            tokenBudget,
            baseRuns: 0,
            candidateRuns: 0,
            recordedAt,
        });
        return record(verdict, [], [], []);
    }
    const candidate = {
        id: input.proposal.id,
        ...(targetClass !== "" ? { targetClass } : {}),
        yaml: input.proposal.yaml,
        adoptedAt: recordedAt,
        evidenceRunId: "probe-pending",
    };
    assertLayerGuardrails(candidate);
    const baseLayerIds = activeLayerIds(input.paths);
    composeActiveLayers(input.paths);
    const candidateLayerIds = [...baseLayerIds, candidate.id];
    input.assertLayersMountable?.(candidateLayerIds);
    const baseRuns = [];
    const candidateRuns = [];
    let tokensSpent = 0;
    let budgetReason = "";
    let staged = false;
    try {
        for (const side of ["base", "candidate"]) {
            if (side === "candidate") {
                installLayer(input.paths, candidate, { installedAt: recordedAt });
                staged = true;
            }
            const layerIds = side === "base" ? baseLayerIds : candidateLayerIds;
            for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
                for (let runIndex = 1; runIndex <= runsPerSide; runIndex++) {
                    if (tokensSpent >= tokenBudget) {
                        budgetReason = `token budget exhausted (${tokensSpent} >= ${tokenBudget}) after ${baseRuns.length} base / ${candidateRuns.length} candidate runs`;
                        break;
                    }
                    const summary = await runOne(input.runEngagement, targets[targetIndex], side, targetIndex, runIndex, layerIds);
                    tokensSpent += summary.metrics.tokensIn + summary.metrics.tokensOut;
                    ingestProbeRun(input.store, { runId: summary.engagementId, target: targets[targetIndex].target, targetClass, layerIds }, summary.metrics);
                    (side === "base" ? baseRuns : candidateRuns).push(summary);
                }
                if (budgetReason !== "")
                    break;
            }
            if (budgetReason !== "")
                break;
        }
    }
    finally {
        if (staged)
            removeLayer(input.paths, candidate.id);
    }
    const base = computeMetrics(baseRuns.map((run) => fromRunMetrics(run.metrics)));
    const candidateMetrics = computeMetrics(candidateRuns.map((run) => fromRunMetrics(run.metrics)));
    const logGap = budgetReason;
    const gate = evaluateGate({ base, candidate: candidateMetrics, heldOutTargets, trainingTargets: training, logGap });
    const verdict = assembleVerdict({
        proposalId: input.proposal.id,
        targetClass,
        base,
        candidate: candidateMetrics,
        gate,
        heldOut,
        approve: input.approve === true,
        tokensSpent,
        tokenBudget,
        baseRuns: baseRuns.length,
        candidateRuns: candidateRuns.length,
        recordedAt,
    });
    return record(verdict, [...baseRuns, ...candidateRuns], baseLayerIds, candidateLayerIds);
}
//# sourceMappingURL=probe.js.map