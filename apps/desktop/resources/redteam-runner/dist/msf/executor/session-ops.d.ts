/**
 * Session operations for the MSF executor (W8): the session follow-through
 * of a validated exploit run, interactive session commands, and session
 * close. Credential dumping lives in executor/credential-dump.ts and runs
 * on the gate exported here.
 *
 * Perimeter (unchanged from the rest of the bridge): exact
 * scope preflight before any daemon contact, sessions addressable only by
 * runner-issued handles bound to the exploited host, destructive-command
 * denylist on session commands, and dumped credential material SEALED to
 * the engagement evidence store — tool results carry counts, types and
 * the evidence reference, never the raw material.
 */
import type { ConsoleRunResult, MsfClient } from "../client.js";
import type { MsfRequestFn } from "../protocol.js";
import type { MsfSessionManager } from "../sessions.js";
import type { MsfResult } from "./executor.js";
/** The slice of MsfExecutor these operations run against. */
export interface SessionOpsHost {
    readonly deps: {
        request?: MsfRequestFn;
        env: NodeJS.ProcessEnv;
        endpoint?: {
            host: string;
            port: number;
            useTls: boolean;
        };
    };
    readonly testMode: boolean;
    readonly sessions: MsfSessionManager;
    preflight(host: string, scopeHosts: string[]): {
        secrets: string[];
    } | {
        refused: string;
    };
    refusedResult(host: string, refused: string, secrets?: string[]): MsfResult;
}
export interface SessionCommandArgs {
    host: string;
    scopeHosts: string[];
    handle: string;
    command: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}
export interface SessionCloseArgs {
    host: string;
    scopeHosts: string[];
    handle: string;
    signal?: AbortSignal;
}
/** Shared gate for every session operation: preflight + handle + host binding. */
export declare function gateSession(host: SessionOpsHost, args: {
    host: string;
    scopeHosts: string[];
    handle: string;
}): {
    record: NonNullable<ReturnType<MsfSessionManager["get"]>>;
} | {
    refused: MsfResult;
};
/**
 * Finish an exploit run whose payload was a Meterpreter session payload:
 * diff the daemon session list, register the new Meterpreter session,
 * stop any other new session, and prove the session by echoing the
 * runner-built marker through it. The session stays OPEN on success —
 * opening it is the mechanical audit-log step that follows the validated
 * exploit; it is registered only after the exploit ran, never before.
 */
export declare function finishSessionRun(host: SessionOpsHost, input: {
    client: MsfClient;
    secrets: string[];
    before: Set<string>;
    console: ConsoleRunResult;
    targetHost: string;
    module: string;
    payload: string;
    marker: string;
    markerCmd: string;
    timeoutMs: number;
    signal?: AbortSignal;
    started: number;
}): Promise<MsfResult>;
/** Run ONE command through an open session. The dispatch layer writes the full command + response to the engagement event log. */
export declare function sessionCommand(host: SessionOpsHost, args: SessionCommandArgs): Promise<MsfResult>;
/** Close an open session (daemon session stopped, handle forgotten). */
export declare function closeSession(host: SessionOpsHost, args: SessionCloseArgs): Promise<MsfResult>;
