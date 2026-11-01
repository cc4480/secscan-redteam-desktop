/**
 * MsfExecutor — the runner's Metasploit bridge, behind the safety core.
 * (Module doc comment preserved on the msf/executor.ts barrel.)
 *
 * Preflight order (mirrors host-exec/executor.ts):
 *   1. ROE scope check (exact hostname match, fail closed, before any packet)
 *   2. module/payload policy (dos + destructive modules refused; generic
 *      single-command payloads run the runner-built canary marker, which
 *      additionally passes the destructive denylist; Meterpreter payloads
 *      open a session — see 6)
 *   4. credential resolution (REDTEAM_MSFRPC_* env/Secure Vault only, fail
 *      fast with setup instructions)
 *   5. execution with timeout + abort signal; the console is destroyed on
 *      abort (the call signal is what stops a running module)
 *   6. session hygiene: a generic-payload validation run must not leave
 *      sessions behind — any session that wasn't there before is stopped
 *      immediately. A Meterpreter-payload run is the one exception (W8):
 *      the session it produces is registered as the mechanical
 *      follow-through of the validated run (executor/session-ops.ts) and
 *      stays open under a runner-issued handle
 *   7. redaction of every secret from every string that leaves
 *
 * The request function is injectable so tests run against a fake msfrpcd.
 */
import { type MsfRequestFn } from "../protocol.js";
import { MsfSessionManager } from "../sessions.js";
import { type SessionCloseArgs, type SessionCommandArgs } from "./session-ops.js";
import { type CredentialDumpArgs } from "./credential-dump.js";
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
    /**
     * TEST MODE (REDTEAM_TEST_MODE): module/payload policy and the canary
     * destructive check are bypassed. Set from the resolved runner config
     * in phases/run.ts; the bypass is recorded by dispatch (dispatch/msf.ts)
     * per call. Default false.
     */
    testMode?: boolean;
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
    /** Set when a Meterpreter-payload run opened a session (W8): the runner-issued handle + daemon id. */
    session?: {
        handle: string;
        daemonId: string;
    };
    /** Set by the credential-dump path: sealed evidence reference — counts/types/ref only, never raw material. */
    evidence?: {
        path: string;
        sha256: string;
        records: number;
        types: string[];
    };
}
export declare const MSF_TIMEOUT_MS = 120000;
export declare class MsfExecutor {
    readonly deps: {
        request?: MsfRequestFn;
        env: NodeJS.ProcessEnv;
        endpoint?: {
            host: string;
            port: number;
            useTls: boolean;
        };
    };
    /** TEST MODE: policy checks bypassed (see MsfDeps.testMode). */
    readonly testMode: boolean;
    /** Live Meterpreter sessions opened by validated runs on this executor (W8). */
    readonly sessions: MsfSessionManager;
    constructor(deps?: MsfDeps);
    refusedResult(host: string, refused: string, secrets?: string[]): MsfResult;
    preflight(host: string, scopeHosts: string[]): {
        secrets: string[];
    } | {
        refused: string;
    };
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
     * Run ONE module. With a generic cmd payload, the only payload action is
     * the benign canary marker: `echo REDTEAM-MARKER-<id>` echoing back IS
     * the validation ("command execution achieved"). With a Meterpreter
     * session payload (W8), the session the run produces is registered and
     * the same marker is proven through the session — the session opens as
     * the mechanical follow-through of the validated run, never before it.
     * No destructive modules in either path.
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
    /** Run ONE command through a session a validated run opened (W8). See executor/session-ops.ts. */
    sessionCommand(args: SessionCommandArgs): Promise<MsfResult>;
    /** Close a session a validated run opened (W8). See executor/session-ops.ts. */
    sessionClose(args: SessionCloseArgs): Promise<MsfResult>;
    /** Dump credential material through an open session, sealed to evidence (W8). See executor/credential-dump.ts. */
    credentialDump(args: CredentialDumpArgs): Promise<MsfResult>;
}
