import { type ResolvedBinary } from "../toolchain.js";
/** Test-only: reset the cached probe so env changes take effect. */
export declare function _resetNucleiProbeCache(): void;
/** Where nuclei would come from and why -- no probe, no spawn. */
export declare function resolveNucleiCommand(env?: NodeJS.ProcessEnv): ResolvedBinary;
export declare function nucleiBinaryPresent(env?: NodeJS.ProcessEnv): boolean;
