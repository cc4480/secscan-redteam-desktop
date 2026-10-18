import type { EngagementInput } from "../types.js";
import { type Harness2Paths, type Proposal, type RunMetrics } from "./contract.js";
import type { Harness2Store } from "./store.js";
import { trainingTargets, type ProbeReport, type ProbeVerdictResult } from "./probe-verdict.js";
export { trainingTargets };
export type ProbeSide = "base" | "candidate";
/** One probe target: the engagement input from the targets file, plus a class hint. */
export interface ProbeTarget extends EngagementInput {
    readonly targetClass?: string;
}
/** What the seam receives for one run: a fresh engagement per run. */
export interface ProbeRunInput extends ProbeTarget {
    readonly engagementId: string;
    readonly side: ProbeSide;
    readonly targetIndex: number;
    readonly runIndex: number;
}
/** The injectable executor seam: run one fresh engagement with these layers, return measured metrics. */
export type ProbeRunFn = (input: ProbeRunInput, layerIds: readonly string[]) => Promise<RunMetrics>;
/** Cap on targets in one probe file, so a typo cannot fan out over a fleet. */
export declare const MAX_PROBE_TARGETS = 20;
/** Default runs of each target per side; one A/B pass is the minimum measurement. */
export declare const DEFAULT_RUNS_PER_SIDE = 1;
/**
 * Load the explicit probe-targets file. Missing path, missing file, invalid
 * JSON, an empty list or more than MAX_PROBE_TARGETS entries all refuse to run:
 * there is no default target and no "discover some targets first" mode.
 */
export declare function loadProbeTargets(targetsFile: string | undefined): ProbeTarget[];
export interface ProbeRunSummary {
    readonly engagementId: string;
    readonly side: ProbeSide;
    readonly targetIndex: number;
    readonly runIndex: number;
    readonly metrics: RunMetrics;
}
export interface ProbeProposalInput {
    readonly paths: Harness2Paths;
    readonly proposal: Proposal;
    /** The committed section-5 store: leakage reference + probe-run ingest. */
    readonly store: Harness2Store;
    /** Explicit probe-targets file; undefined refuses the probe. */
    readonly targetsFile: string | undefined;
    /** The injectable executor seam: (input, layerIds) => RunMetrics. */
    readonly runEngagement: ProbeRunFn;
    /** Capability check for the layer set the candidate run needs (see probe-cli.ts). */
    readonly assertLayersMountable?: (layerIds: readonly string[]) => void;
    /** Runs of each target per side; default DEFAULT_RUNS_PER_SIDE. */
    readonly runsPerSide?: number;
    /** Token cap for the whole probe; default DEFAULT_TOKEN_BUDGET. */
    readonly tokenBudget?: number;
    /** Explicit operator approval. Absent => propose-only: adopted is always false. */
    readonly approve?: boolean;
    /** Clock seam (tests). */
    readonly now?: () => Date;
}
/**
 * Run one offline probe of `proposal` and return the section-8 verdict. Refuses
 * before any run without an explicit targets file; reports INSUFFICIENT_DATA
 * before any run for fewer than 8 distinct held-out targets, a store log gap or
 * a leaked held-out set that cannot be measured honestly.
 */
export declare function probeProposal(input: ProbeProposalInput): Promise<ProbeVerdictResult>;
export type { ProbeReport, ProbeVerdictResult };
