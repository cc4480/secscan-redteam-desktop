/**
 * ExecutorCore: shared host-execution machinery (v0.19.0 refactor — extracted from executor.ts).
 */
import { type HostCredentials } from "../common.js";
import { type HostExecResult, type HostExecDeps } from "./types.js";
export declare class ExecutorCore {
    readonly deps: Required<Pick<HostExecDeps, "ssh" | "smb" | "smbPth" | "winrm" | "rdp" | "ad" | "krb" | "nfs">> & {
        env: NodeJS.ProcessEnv;
    };
    /** Kill-switch state, shared with the engagement context (phases.ts owns it). */
    killSwitch: {
        aborted: boolean;
    };
    bounded<T>(p: Promise<T>, ms: number, label: string, t: {
        close(): Promise<void>;
    }): Promise<T>;
    constructor(deps?: HostExecDeps);
    preflight(transport: HostExecResult["transport"], host: string, scopeHosts: string[], command?: string): {
        creds: HostCredentials;
        secrets: string[];
    } | {
        refused: string;
    };
    /**
     * Preflight for unauthenticated recon (WinRM probe, NFS enumeration):
     * kill-switch → scope check, then done. No credential resolution —
     * these tools are unauthenticated by design, so no secrets exist and
     * redaction over [] is a no-op. No denylist either — no commands run.
     */
    preflightNoCreds(_transport: HostExecResult["transport"], host: string, scopeHosts: string[]): {
        secrets: string[];
    } | {
        refused: string;
    };
    refusedResult(transport: HostExecResult["transport"], host: string, refused: string, secrets?: string[]): HostExecResult;
}
