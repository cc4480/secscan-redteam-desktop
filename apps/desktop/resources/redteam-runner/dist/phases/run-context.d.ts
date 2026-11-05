/**
 * The engagement context assembled from the resolved config — split out of
 * phases/run.ts for the file budget, with no behaviour change: the same
 * fields, the same constructors in the same order, and the same lazy
 * sealed-host closure over the context being built.
 */
import { type Ctx, type RunnerDeps } from '../context.js';
import { EventLog } from '../events.js';
import { type EngagementInput, type ResolvedRunnerConfig } from '../types.js';
export interface BuildEngagementContextOptions {
    input: EngagementInput;
    config: ResolvedRunnerConfig;
    deps: RunnerDeps;
    events: EventLog;
    /** The ROE scope hosts, already parsed and checked non-empty by the caller. */
    hosts: string[];
    environment: Ctx['safety']['environment'];
    prodConfirmed: boolean;
    rps: number;
    productionCapApplied: boolean;
    tier: Ctx['tier']['current'];
    approvals: Ctx['approvals'];
    registry: Ctx['registry'];
    registryPath: string;
}
export declare function buildEngagementContext(opts: BuildEngagementContextOptions): Ctx;
