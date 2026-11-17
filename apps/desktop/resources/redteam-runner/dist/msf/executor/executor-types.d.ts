/**
 * MsfExecutor's public shapes — MsfDeps, MsfResult and the console timeout —
 * split out of executor.ts for the file budget with no behaviour change.
 * executor.ts re-exports all three, so every importer and the msf barrel
 * keep the same surface.
 */
import { type MsfSpawnFn } from '../local-client.js';
export interface MsfDeps {
    /** Injectable msfconsole process spawner (default: spawn the real local binary). Tests drive a scripted fake console. */
    spawn?: MsfSpawnFn;
    env?: NodeJS.ProcessEnv;
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
    /** Set when the safety core refused before any local process was spawned. */
    refused?: string;
    /** Set when a Meterpreter-payload run opened a session (W8): the runner-issued handle + runtime session id. */
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
