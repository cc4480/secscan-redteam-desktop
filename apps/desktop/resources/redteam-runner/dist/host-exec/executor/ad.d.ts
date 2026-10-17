import { ExecutorCore } from "./core.js";
import { type HostExecResult } from "./types.js";
export declare function adEnumImpl(core: ExecutorCore, args: {
    host: string;
    port?: number;
    useTls?: boolean;
    baseDn?: string;
    operations: string[];
    scopeHosts: string[];
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<HostExecResult>;
/**
 * Pass-the-ticket (battery WS-064). Ticket material via env (ccache/kirbi)
 * or kinit as the test account; replayed ccache-only with kvno proof.
 * The SPN's hostname is scope-checked in addition to the host.
 */
