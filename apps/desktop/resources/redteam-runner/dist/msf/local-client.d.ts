/**
 * LocalMsfClient — native local execution of the Metasploit Framework.
 *
 * The framework installed on THIS host is driven as local `msfconsole` child
 * processes (no daemon, no RPC, no credentials/listener): module search runs
 * one-shot (`msfconsole -q -x "search …; exit"`), module runs write the
 * console command stream (`use`, `set`, `set PAYLOAD`/`set CMD`, `run`) to a
 * dedicated process, and Meterpreter interaction goes through `sessions -i` /
 * `background` in the process that opened the session.
 *
 * Process/session state lives in the shared runtime (console-runtime.ts);
 * client instances are thin facades over it. What MAY run (module/payload
 * policy) is unchanged and lives in policy.ts; this module owns only the client
 * operations. All methods fail closed: a missing/unrunnable framework throws
 * MsfAuthError with setup instructions; session hygiene never throws.
 */
import { type MsfSpawnFn } from "./console-runtime.js";
export { parseMsfSearchOutput, MSF_CONSOLE_QUIET_MS, _resetMsfRuntimeForTests } from "./console-runtime.js";
export type { MsfConsoleProcess, MsfSpawnFn } from "./console-runtime.js";
export declare class MsfAuthError extends Error {
    constructor(message: string);
}
export interface MsfModule {
    type: string;
    name: string;
    fullname: string;
    rank: string;
    description: string;
    disclosureDate?: string;
}
/**
 * A source of Metasploit module search results. Both the native console source
 * and any other implementation satisfy this one method, so the search and
 * suggest paths are agnostic about how modules are listed.
 */
export interface ModuleSearchSource {
    searchModules(query: string): Promise<MsfModule[]>;
}
export interface ConsoleRunResult {
    /** Full captured console output (capped by caller). */
    output: string;
    /** True when the console went idle (module finished) before the deadline. */
    completed: boolean;
    /** True when we gave up waiting and killed the console. */
    timedOut: boolean;
    /** True when the abort signal fired and we killed the console. */
    aborted: boolean;
}
export interface LocalMsfClientDeps {
    /** Resolved msfconsole binary path (toolchain resolver output). */
    bin: string;
    /** Injectable spawner — tests drive a scripted fake console. */
    spawn?: MsfSpawnFn;
}
/**
 * Thin facade over the shared runtime: drives the host's own Metasploit
 * framework as local msfconsole processes. See the module doc comment.
 */
export declare class LocalMsfClient {
    private readonly bin;
    private readonly spawnFn;
    constructor(deps: LocalMsfClientDeps);
    private requireProbe;
    /**
     * Verify the local framework actually runs (`msfconsole --version`).
     * Cached in the shared runtime — later clients skip the probe.
     * Throws MsfAuthError (with setup instructions) on any failure.
     */
    login(): Promise<void>;
    /** Search the module database via a one-shot console. Query uses msf search syntax. */
    searchModules(query: string): Promise<MsfModule[]>;
    /** Current sessions across every live console process (runtime id → info). */
    sessionList(): Promise<Record<string, Record<string, unknown>>>;
    /** Stop one session: `sessions -k` when its process hosts others, otherwise kill the process. Never throws. */
    sessionStop(daemonId: string): Promise<void>;
    /**
     * Write to a live Meterpreter session's command channel. Only the
     * session manager calls this, and only for sessions registered from a
     * validated exploit run. Enters the session (`sessions -i`) first when
     * the process is not already interacting with it.
     */
    sessionMeterpreterWrite(daemonId: string, data: string): Promise<void>;
    /** Drain a console process's pending output (the session channel's read side). Returns "" when idle. */
    sessionMeterpreterRead(daemonId: string): Promise<string>;
    /**
     * Run a module and capture its console output.
     *
     * Post modules pinned to a SESSION run inside that session's owning
     * process (the only place the session exists). Every other run gets a
     * dedicated process: the stream is `use` → `set` each option →
     * `set PAYLOAD`/`set CMD` → `run`, captured until the console goes
     * quiet, the deadline hits, or the abort signal fires (abort/timeout
     * kills the process — that is the call signal for a running module).
     * A run whose output reports a session opening keeps its process alive
     * and registers the session in the shared runtime; any other finished
     * process is killed, so a validation run cannot leave consoles behind.
     */
    runModuleConsole(args: {
        moduleType: "exploit" | "auxiliary" | "post";
        fullname: string;
        options: Record<string, string>;
        payload?: string;
        cmd?: string;
        timeoutMs: number;
        signal?: AbortSignal;
    }): Promise<ConsoleRunResult>;
}
