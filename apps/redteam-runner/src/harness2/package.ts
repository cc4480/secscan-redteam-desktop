/**
 * Harness2 proposal package builder (H2-P2a): facade.
 *
 * This is the paste-ready artifact Carlos gives the frontier editor: the
 * current sources of every EDITABLE harness component, contrasted runs from the
 * store, the class's lessons, aggregate metrics and the editing instructions.
 * parseProposalResponse (re-exported here) turns the editor's pasted-back answer
 * into a contract.Proposal and hard-rejects (and flags) pinned-guardrail touches.
 *
 * The implementation is split to stay inside the runner's 300-line file budget:
 *   package-component-map.ts  documented component path map + verbatim reads
 *   package-pairs.ts          ranked contrasted-pair selection + metrics
 *   package-experience.ts     EXPERIENCE.md parsing (H2-P3 canonical format)
 *   package-parse.ts          pasted-back answer parsing + guardrail auto-reject
 *   package-instructions.ts   the editing instructions block
 *   package-render.ts         paste-ready markdown + atomic writer
 *
 * PAIR SELECTION RULE (mechanical): positive pool = the top maxPairs runs with
 * outcome success|partial and vulnsFound > 0, ranked by vulnsFound desc,
 * exploitsSucceeded desc, steps asc, runId asc; negative pool = every
 * non-aborted run with at least one step and outcome failure|partial, ranked by
 * vulnsFound asc, failure before partial, exploitsSucceeded asc, runId asc.
 * Aborted runs and zero-step failures are skipped as non-comparable (and
 * noted); up to maxPairs (default 2) greedy pairs are drawn from the ranked
 * pools without reusing a run; differing layer sets are allowed but noted as
 * not layer-controlled.
 *
 * Guardrails are PINNED (contract.PINNED_COMPONENT): absent from the component
 * map, re-checked per resolved path, and any proposed YAML touching src/safety,
 * src/policy or auth-gate is rejected with flagged=true.
 */
import { resolveHarness2Paths } from "./contract.js";
import type { ProposalPackage, TargetClass } from "./contract.js";
import { resolveLayerIds } from "./harness-stamp.js";
import type { Harness2Store } from "./store-model.js";
import { findRepoRoot, readComponentFiles } from "./package-component-map.js";
import { DEFAULT_PAIR_COUNT, RUN_SCAN_LIMIT, buildMetrics, selectPairs } from "./package-pairs.js";
import { readClassExperience } from "./package-experience.js";
import { buildInstructions } from "./package-instructions.js";

export interface BuildProposalPackageInput {
  readonly store: Harness2Store;
  readonly targetClass: TargetClass;
  readonly environment?: NodeJS.ProcessEnv;
  /** Maximum contrasted pairs; default 2. */
  readonly maxPairs?: number;
  /** Repo root for component sources; discovered when omitted (tests pin it). */
  readonly repoRoot?: string;
  /** EXPERIENCE root override; defaults to resolveHarness2Paths(environment).experience. */
  readonly experienceDir?: string;
}

/** Assemble the paste-ready proposal package for one target class. */
export function buildProposalPackage(input: BuildProposalPackageInput): ProposalPackage {
  const environment = input.environment ?? process.env;
  const repoRoot = input.repoRoot ?? findRepoRoot();
  const experienceDir = input.experienceDir ?? resolveHarness2Paths(environment).experience;
  const maxPairs = Math.max(1, Math.trunc(input.maxPairs ?? DEFAULT_PAIR_COUNT));
  const rows = input.store.listRuns({ targetClass: input.targetClass, limit: RUN_SCAN_LIMIT });
  const selection = selectPairs(input.store, input.targetClass, maxPairs);
  const componentFiles = readComponentFiles(repoRoot);
  const sourceBytes = componentFiles.reduce((total, entry) => total + entry.body.length, 0);
  const latest = rows[0];
  const envLayers = resolveLayerIds(environment);
  const baseLayerSet = latest !== undefined && latest.layerSet.length > 0 ? latest.layerSet : envLayers.length > 0 ? envLayers : (latest?.layerSet ?? []);
  return {
    targetClass: input.targetClass,
    baseLayerSet,
    componentFiles,
    pairs: selection.pairs,
    experience: readClassExperience(experienceDir, input.targetClass),
    metrics: buildMetrics(rows, selection.positives, selection.negatives),
    instructions: buildInstructions(selection.notes, sourceBytes),
  };
}

export * from "./package-component-map.js";
export * from "./package-pairs.js";
export * from "./package-experience.js";
export * from "./package-parse.js";
export * from "./package-instructions.js";
export * from "./package-render.js";
