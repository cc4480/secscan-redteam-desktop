import type { ProbeContext, RedTeamFinding } from "./types.js";
export declare function probeCommandInjection(ctx: ProbeContext): Promise<RedTeamFinding | null>;
