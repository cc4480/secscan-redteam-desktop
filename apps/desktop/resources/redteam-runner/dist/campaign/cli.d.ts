/**
 * Campaign CLI (Q-CAMPAIGN, Decision C-2: the v1 surface is CLI-only).
 *
 *   campaign create --id <id> --name <n> --kind web-hunt --scope h1[,h2]
 *                   --verification <ref> --objective <text> --operator <name>
 *                   [--max-waves N] [--max-budget N] [--roe-ref <ref>]
 *   campaign list
 *   campaign status <id>
 *   campaign plan <id>                      (plan + arm the next wave)
 *   campaign advance <id> --operator <n>    (record start/advance — the C-1 gate key)
 *   campaign auto <id> --operator <n> --max-wave N
 *   campaign auto-off <id> --operator <n>
 *   campaign pause|resume|stop|complete <id> --operator <n>
 *   campaign run <id> [--mode red|black] [--tier N]   (launch the next wave, gated)
 *   campaign repair                         (restart repair of stranded waves)
 *
 * The operator commands exist because the gate is decision-shaped:
 * `advance` records the decision the gate will check at `run`. There
 * is deliberately no flag that skips the gate — run without a recorded
 * decision refuses, every time, and says which decision is missing.
 */
import type { WavePlannerCompletion } from './planner.js';
export declare class CampaignCliError extends Error {
    constructor(message: string);
}
/** Injectable dependencies (tests drive the CLI keyless with fakes). */
export interface CampaignCliDeps {
    campaignsDir?: string;
    completion?: WavePlannerCompletion;
    runFn?: typeof import('../phases/run.js').runEngagement;
    out?: (line: string) => void;
}
/**
 * Run one campaign CLI invocation. Returns the process exit code
 * (0 ok, 1 operational failure, 2 usage error) and never throws for
 * expected failures — the refusal IS the output.
 * @param argv - Arguments after the `campaign` command word.
 * @param deps - Injectable store/planner/runner/output dependencies.
 * @returns The exit code.
 */
export declare function runCampaignCli(argv: string[], deps?: CampaignCliDeps): Promise<number>;
