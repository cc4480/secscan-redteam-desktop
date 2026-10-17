import { ExecutorCore } from "./core.js";
import { type HostExecResult } from "./types.js";
export declare function krbPttImpl(core: ExecutorCore, args: {
    host: string;
    spn?: string;
    scopeHosts: string[];
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<HostExecResult>;
