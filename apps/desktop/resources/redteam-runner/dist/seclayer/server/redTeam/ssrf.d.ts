import type { ProbeContext, RedTeamFinding } from "./types.js";
export declare function probeSsrf(ctx: ProbeContext): Promise<RedTeamFinding | null>;
