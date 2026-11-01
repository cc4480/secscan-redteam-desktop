import type { OobCollaborator } from "./oob.js";
import type { EmitFn } from "./scanEvents.js";
import type { Probe, RedTeamFinding } from "./redTeam/types.js";
export declare const PROBES: Probe[];
export declare const RED_TEAM_PROBE_COUNT: number;
export declare function runRedTeamProbes(url: string, headers: Record<string, string>, opts?: {
    oob?: OobCollaborator;
    scanId?: string;
    emit?: EmitFn;
}): Promise<RedTeamFinding[]>;
