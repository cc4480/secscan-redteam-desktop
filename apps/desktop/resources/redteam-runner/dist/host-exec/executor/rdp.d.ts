import { ExecutorCore } from "./core.js";
import { type HostExecResult } from "./types.js";
export declare function rdpValidateImpl(core: ExecutorCore, args: {
    host: string;
    port?: number;
    scopeHosts: string[];
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<HostExecResult>;
/**
 * RDP shadow preparation (battery WS-065) — HUMAN-GATED. Runs the
 * read-only session/policy enumeration over WinRM and builds the complete
 * human handoff package. The runner NEVER shadows a session.
 */
export declare function rdpShadowPrepImpl(core: ExecutorCore, args: {
    host: string;
    scopeHosts: string[];
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<HostExecResult>;
/**
 * Pass-the-hash over SMB with NTLMv2 (battery WS-023). The NT hash is the
 * test account's OWN, client-provided via REDTEAM_SMB_NTHASH — handled
 * with password-grade secrecy.
 */
