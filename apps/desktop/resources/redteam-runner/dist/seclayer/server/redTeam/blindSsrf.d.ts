import type { ProbeContext, RedTeamFinding } from "./types.js";
export declare function probeBlindSsrf(ctx: ProbeContext): Promise<RedTeamFinding | null>;
