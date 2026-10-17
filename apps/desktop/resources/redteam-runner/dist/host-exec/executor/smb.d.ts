import { ExecutorCore } from "./core.js";
import { type HostExecResult } from "./types.js";
export declare function smbExecImpl(core: ExecutorCore, args: {
    host: string;
    operation: "list_shares" | "list_dir" | "stat";
    share?: string;
    path?: string;
    extraShares?: string[];
    scopeHosts: string[];
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<HostExecResult>;
export declare function smbPthImpl(core: ExecutorCore, args: {
    host: string;
    port?: number;
    scopeHosts: string[];
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<HostExecResult>;
/**
 * Read-only AD enumeration (batteries WS-038 attack paths, WS-043 AD CS).
 * LDAP simple bind as the test account; nothing is ever written.
 */
