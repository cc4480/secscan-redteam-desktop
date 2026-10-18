import { type ResolvedBinary } from "../toolchain.js";
/** Test-only: reset the cached probe so env changes take effect. */
export declare function _resetNmapProbeCache(): void;
/** Where nmap would come from and why -- no probe, no spawn. */
export declare function resolveNmapCommand(env?: NodeJS.ProcessEnv): ResolvedBinary;
export declare function nmapBinaryPresent(env?: NodeJS.ProcessEnv): boolean;
