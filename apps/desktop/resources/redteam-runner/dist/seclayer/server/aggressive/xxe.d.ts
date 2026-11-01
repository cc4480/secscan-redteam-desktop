import type { ProbeContext, RedTeamFinding } from "../redTeam/types.js";
export declare function probeXxe(ctx: ProbeContext): Promise<RedTeamFinding | null>;
