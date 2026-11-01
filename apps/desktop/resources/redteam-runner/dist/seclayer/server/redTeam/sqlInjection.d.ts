import type { ProbeContext, RedTeamFinding } from "./types.js";
export declare function probeSqlInjection(ctx: ProbeContext): Promise<RedTeamFinding | null>;
