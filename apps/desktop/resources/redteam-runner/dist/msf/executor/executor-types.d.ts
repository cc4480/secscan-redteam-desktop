/**
 * MsfExecutor's public shapes — MsfDeps, MsfResult and the console timeout —
 * split out of executor.ts for the file budget with no behaviour change.
 * executor.ts re-exports all three, so every importer and the msf barrel
 * keep the same surface.
 */
import { type MsfRequestFn } from '../protocol.js';
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
    transport: 'msf';
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
