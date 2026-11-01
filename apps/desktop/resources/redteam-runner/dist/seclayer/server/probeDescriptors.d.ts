import type { EmitFn } from "./scanEvents.js";
import type { RedTeamFinding } from "./scanTypes.js";
export interface ProbeDescriptor {
    label: string;
    payload: string;
    why: string;
}
export declare const PROBE_DESCRIPTORS: Record<string, ProbeDescriptor>;
export declare function emitProbeFiring(emit: EmitFn | undefined, desc?: ProbeDescriptor): void;
export declare function emitProbeResult(emit: EmitFn | undefined, desc: ProbeDescriptor | undefined, finding: RedTeamFinding | null): void;
