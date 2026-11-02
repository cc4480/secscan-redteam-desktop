import { type Finding } from "../types.js";
import { type Ctx } from "../context.js";
export { applyCellVerdicts, haltedFindingFromLive, mergeReporterFindings } from "./cell-verdicts.js";
export declare function reportPhase(ctx: Ctx, reconBrief: string, exploitSummary: string, opts?: {
    haltedReason?: string;
    blockedReason?: string;
}): Promise<Finding[]>;
