/**
 * MsfExecutor — the runner's Metasploit bridge, behind the safety core.
 * (Module doc comment preserved on the msf/executor.ts barrel.)
 *
 * Preflight order (mirrors host-exec/executor.ts):
 *   1. kill-switch check (refuse new work when the coordinator aborted)
 *   2. ROE scope check (exact hostname match, fail closed, before any packet)
 *   3. module/payload policy (dos + destructive modules refused; only
 *      generic single-command payloads; the command is always the runner-built
 *      canary marker and additionally passes the destructive denylist)
 *   4. credential resolution (REDTEAM_MSFRPC_* env/Secure Vault only, fail
 *      fast with setup instructions)
 *   5. execution with timeout + abort signal; the console is destroyed on
 *      abort (that IS the kill switch for a running module)
 *   6. session hygiene: a validation run must not leave sessions behind —
 *      any session that wasn't there before is stopped immediately
 *   7. redaction of every secret from every string that leaves
 *
 * The request function is injectable so tests run against a fake msfrpcd.
 */
import { type MsfRequestFn } from "../protocol.js";
export interface MsfDeps {
    /** Injectable transport (default: HTTPS to the operator's msfrpcd). */
    request?: MsfRequestFn;
    env?: NodeJS.ProcessEnv;
    /** Override msfrpcd endpoint (tests). */
    endpoint?: {
        host: string;
        port: number;
        useTls: boolean;
    };
}
export interface MsfResult {
    ok: boolean;
    transport: "msf";
    host: string;
    /** Redacted one-line summary for audit logs and events. */
    summary: string;
    /** Redacted, capped output. */
    output: string;
    ms: number;
    /** Set when the safety core refused before contacting msfrpcd. */
    refused?: string;
}
export declare const MSF_TIMEOUT_MS = 120000;
export declare class MsfExecutor {
    private readonly deps;
    /** Kill-switch state, shared with the engagement context (phases.ts owns it). */
    killSwitch: {
        aborted: boolean;
    };
    constructor(deps?: MsfDeps);
    private refusedResult;
    private preflight;
    /**
     * Search the module database (recon-safe: no module runs).
     * `query` uses msf search syntax; when omitted, `cve`/`service` build it.
     */
    search(args: {
        host: string;
        scopeHosts: string[];
        query?: string;
        cve?: string;
        service?: string;
        platform?: string;
        signal?: AbortSignal;
    }): Promise<MsfResult>;
    /**
     * Recon → module mapping: detected service/version → ranked candidate
     * modules. The candidates go to the COORDINATOR for approval — this tool
     * never fires an exploit. That approval is the recon→exploit sign-off
     * the coordinator already owns.
     */
    suggest(args: {
        host: string;
        scopeHosts: string[];
        service?: string;
        version?: string;
        cve?: string;
        platform?: string;
        signal?: AbortSignal;
    }): Promise<MsfResult>;
    /**
     * Run ONE module with a benign canary marker as the only payload action.
     * Exploits use a generic cmd payload running `echo REDTEAM-MARKER-<id>` —
     * the marker echoing back IS the validation ("command execution
     * achieved"). No sessions, no post-exploitation, no destructive modules.
     */
    run(args: {
        host: string;
        scopeHosts: string[];
        moduleType: "exploit" | "auxiliary";
        module: string;
        /** Module datastore options (RHOSTS etc. derived from host — secrets never in here). */
        options?: Record<string, string>;
        payload?: string;
        /** Canary id echoed by the marker command (runner-generated upstream). */
        marker: string;
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<MsfResult>;
}
