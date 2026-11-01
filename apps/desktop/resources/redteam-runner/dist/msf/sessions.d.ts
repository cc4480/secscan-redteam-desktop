/**
 * MsfSessionManager — the registry of live Meterpreter sessions (W8).
 *
 * A record exists ONLY because a validated exploit run produced the
 * session: the executor snapshots the daemon's session list before the
 * run, diffs it after, and registers the new Meterpreter session here as
 * the mechanical follow-through of that run. There is deliberately no
 * "open a session" entry point — nothing can register a session against
 * a host that was not just exploited, and every record is bound to the
 * exact scope-checked host the exploit ran against.
 *
 * A session is transport, not proof: registration records the validated
 * run's marker, and the executor still proves the session by echoing the
 * runner-built marker through it before any agent command runs.
 *
 * Handles are runner-generated UUIDs; the daemon's numeric session ids
 * never leave the runner, so an agent cannot address a session the
 * runner did not register (a foreign or pre-existing daemon session is
 * unreachable through this registry).
 */
import type { MsfClient } from "./client.js";
export interface MsfSessionRecord {
    /** Runner-generated handle — the only way agents address the session. */
    handle: string;
    /** msfrpcd session id (runner-internal). */
    daemonId: string;
    /** Scope-checked host the validating exploit ran against. */
    targetHost: string;
    /** Exploit module (without type prefix) that produced the session. */
    module: string;
    /** Session payload the exploit ran with. */
    payload: string;
    /** Canary marker id of the validated run that produced the session. */
    marker: string;
    openedAt: string;
}
export declare class MsfSessionManager {
    private readonly sessions;
    /**
     * Register a session the executor observed appearing during a
     * validated exploit run. Called by the executor only — see header.
     */
    register(input: {
        daemonId: string;
        targetHost: string;
        module: string;
        payload: string;
        marker: string;
    }): MsfSessionRecord;
    get(handle: string): MsfSessionRecord | undefined;
    list(): MsfSessionRecord[];
    /**
     * Run ONE command through the session and collect its response.
     * Polls the read channel until output goes idle or the deadline hits;
     * the abort signal interrupts the wait immediately.
     * Throws on an unknown/closed handle — callers translate to a refusal.
     */
    exec(client: MsfClient, handle: string, command: string, opts: {
        timeoutMs: number;
        signal?: AbortSignal;
    }): Promise<{
        record: MsfSessionRecord;
        output: string;
    }>;
    /** Stop the daemon session and forget the handle. False when unknown. */
    close(client: MsfClient, handle: string): Promise<boolean>;
}
