import type { OobCollaborator } from "../oob.js";
import type { RedTeamFinding } from "../scanTypes.js";
export type { RedTeamFinding } from "../scanTypes.js";
export interface ProbeContext {
    url: string;
    fuzzHeaders: Record<string, string>;
    oob?: OobCollaborator;
    scanId?: string;
}
export type Probe = (ctx: ProbeContext) => Promise<RedTeamFinding | null>;
