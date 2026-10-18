import { type RunOptions } from "../phases.js";
import { type Harness2Paths, type Proposal } from "./contract.js";
import { DEFAULT_TOKEN_BUDGET } from "./probe-verdict.js";
import { type ProbeRunFn } from "./probe.js";
/** The exact runner change a real layer mount needs; thrown verbatim by the seam. */
export declare const LAYER_MOUNT_INTEGRATION_POINT: string;
export interface RunnerProbeSeam {
    readonly runEngagement: ProbeRunFn;
    readonly assertLayersMountable: (layerIds: readonly string[]) => void;
}
export interface RunnerProbeSeamOptions {
    readonly paths: Harness2Paths;
    /** Where probe engagements are written; defaults to <paths.runs>/probe-engagements. */
    readonly engagementsDir?: string;
    /** Runner options for every probe run (max actions, dry-run, ...). */
    readonly runOptions?: Omit<RunOptions, "engagementsDir" | "engagementId">;
    /** The real mount step (see LAYER_MOUNT_INTEGRATION_POINT). Absent => non-empty layer sets are refused. */
    readonly mountLayers?: (layerIds: readonly string[]) => void;
}
/**
 * Wire the real runner as the probe executor. `assertLayersMountable` is called
 * by probeProposal BEFORE any run, so the CLI refuses cleanly (no tokens spent)
 * while the runner has no mount.
 */
export declare function createRunnerProbeSeam(options: RunnerProbeSeamOptions): RunnerProbeSeam;
export interface ProbeCliIo {
    readonly out: (line: string) => void;
    readonly err: (line: string) => void;
}
/** Read and validate a Proposal JSON written by the P2a package flow. */
export declare function readProposalFile(path: string): Proposal;
/** `harness2 propose --proposal <proposal.json>`: validate + record. Never adopts. */
export declare function proposeCommand(argv: readonly string[], io?: ProbeCliIo, environment?: NodeJS.ProcessEnv): number;
/** `harness2 probe --proposal P --targets T [--runs N] [--budget TOKENS] [--approve]`: measure only. */
export declare function probeCommand(argv: readonly string[], io?: ProbeCliIo, environment?: NodeJS.ProcessEnv): Promise<number>;
export { DEFAULT_TOKEN_BUDGET };
