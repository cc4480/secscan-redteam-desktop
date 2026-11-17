/**
 * MsfExecutor — the runner's Metasploit arm, behind the safety core.
 * (Module doc comment preserved on the msf/executor.ts barrel.)
 *
 * Preflight order (mirrors host-exec/executor.ts):
 *   1. ROE scope check (exact hostname match, fail closed, before any
 *      local process is spawned)
 *   2. module/payload policy (dos + destructive modules refused; generic
 *      single-command payloads run the runner-built canary marker, which
 *      additionally passes the destructive denylist; Meterpreter payloads
 *      open a session — see 6)
 *   4. framework availability (the local msfconsole resolves and executes,
 *      fail fast with setup instructions)
 *   5. execution with timeout + abort signal; the console process is
 *      killed on abort (the call signal is what stops a running module)
 *   6. session hygiene: a generic-payload validation run must not leave
 *      sessions behind — any session that wasn't there before is stopped
 *      immediately. A Meterpreter-payload run is the one exception (W8):
 *      the session it produces is registered as the mechanical
 *      follow-through of the validated run (executor/session-ops.ts) and
 *      stays open under a runner-issued handle
 *   7. redaction of every secret from every string that leaves
 *
 * The process spawner is injectable so tests run against a fake msfconsole.
 */
import { type MsfSpawnFn } from '../local-client.js';
import { MsfSessionManager } from '../sessions.js';
import { type SessionCloseArgs, type SessionCommandArgs } from './session-ops.js';
import { type CredentialDumpArgs } from './credential-dump.js';
import type { MsfDeps, MsfResult } from './executor-types.js';
import { type MsfSearchArgs, type MsfSuggestArgs } from './executor-query.js';
export { MSF_TIMEOUT_MS } from './executor-types.js';
export type { MsfDeps, MsfResult } from './executor-types.js';
export declare class MsfExecutor {
    readonly deps: {
        spawn?: MsfSpawnFn;
        env: NodeJS.ProcessEnv;
        testMode?: boolean;
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
     * The body lives in executor-query.ts (file-budget split).
     */
    search(args: MsfSearchArgs): Promise<MsfResult>;
    /**
     * Recon → module mapping: detected service/version → ranked candidate
     * modules. The candidates go to the COORDINATOR for approval — this tool
     * never fires an exploit. That approval is the recon→exploit sign-off
     * the coordinator already owns. The body lives in executor-query.ts.
     */
    suggest(args: MsfSuggestArgs): Promise<MsfResult>;
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
        moduleType: 'exploit' | 'auxiliary';
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
