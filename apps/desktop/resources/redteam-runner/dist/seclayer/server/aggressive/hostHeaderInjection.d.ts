import type { ProbeContext, RedTeamFinding } from "../redTeam/types.js";
export declare function probeHostHeaderInjection(ctx: ProbeContext): Promise<RedTeamFinding | null>;
