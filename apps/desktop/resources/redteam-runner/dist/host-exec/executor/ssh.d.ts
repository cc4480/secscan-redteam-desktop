import { ExecutorCore } from "./core.js";
import { type HostExecResult } from "./types.js";
export declare function sshExecImpl(core: ExecutorCore, args: {
    host: string;
    port?: number;
    command: string;
    scopeHosts: string[];
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<HostExecResult>;
