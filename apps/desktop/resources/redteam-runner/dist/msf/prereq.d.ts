import { type ResolvedBinary } from "../toolchain.js";
/** Test-only: reset the cached probe so env changes take effect. */
export declare function _resetMsfProbeCache(): void;
/** Where msfconsole would come from and why — no probe, no spawn. */
export declare function resolveMsfConsoleCommand(env?: NodeJS.ProcessEnv): ResolvedBinary;
/** True when the local Metasploit framework is installed and runnable. */
export declare function msfBinaryPresent(env?: NodeJS.ProcessEnv): boolean;
