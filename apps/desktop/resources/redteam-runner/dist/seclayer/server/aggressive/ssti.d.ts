import type { ProbeContext, RedTeamFinding } from "../redTeam/types.js";
export declare function probeSsti(ctx: ProbeContext): Promise<RedTeamFinding | null>;
