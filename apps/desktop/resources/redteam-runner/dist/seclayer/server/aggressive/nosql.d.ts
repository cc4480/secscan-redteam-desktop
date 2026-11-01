import type { ProbeContext, RedTeamFinding } from "../redTeam/types.js";
export declare function probeNoSql(ctx: ProbeContext): Promise<RedTeamFinding | null>;
