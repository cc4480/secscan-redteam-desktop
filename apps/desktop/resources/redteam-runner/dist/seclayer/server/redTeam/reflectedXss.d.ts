import type { ProbeContext, RedTeamFinding } from "./types.js";
export declare function probeReflectedXss(ctx: ProbeContext): Promise<RedTeamFinding | null>;
