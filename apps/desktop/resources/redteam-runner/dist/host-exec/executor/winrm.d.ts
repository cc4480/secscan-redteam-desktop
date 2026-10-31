import { type WinrmProbeRequestImpl } from "../winrm.js";
import { ExecutorCore } from "./core.js";
import { type HostExecResult } from "./types.js";
export declare function winrmExecImpl(core: ExecutorCore, args: {
    host: string;
    port?: number;
    command: string;
    powershell?: boolean;
    useTls?: boolean;
    scopeHosts: string[];
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<HostExecResult>;
/**
 * WinRM listener probe (battery WS-010). Unauthenticated reconnaissance:
 * one POST /wsman per port, reads the 401 challenge. Preflight is
 * kill-switch + scope only — no credentials are resolved or sent.
 * `ok` means the probe completed (per-port answers in `output`);
 * a port with no listener is a finding, not a failure.
 */
export declare function winrmProbeImpl(core: ExecutorCore, args: {
    host: string;
    ports?: number[];
    scopeHosts: string[];
    timeoutMs?: number;
    signal?: AbortSignal;
    /** Test seam — production callers leave this unset. */
    requestImpl?: WinrmProbeRequestImpl;
}): Promise<HostExecResult>;
/**
 * NFS export enumeration (battery LX-041). Unauthenticated by design —
 * the mount protocol's EXPORT procedure needs no credentials.
 * Preflight is kill-switch + scope only; no commands run so the denylist
 * does not apply (documented, not skipped silently). Never mounts
 * anything — see nfs.ts.
 */
