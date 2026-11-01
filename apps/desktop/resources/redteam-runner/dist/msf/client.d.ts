/**
 * MsfClient — thin typed wrapper over msfrpc (msfCall).
 *
 * Covers what the bridge needs: auth, module search, console-based module
 * execution WITH output capture (the evidence for "command execution
 * achieved"), session read/write for registered sessions, and session
 * hygiene (a session no validated run registered is stopped immediately;
 * a Meterpreter run's own session is registered, never stopped by hygiene).
 *
 * All methods throw MsfTransportError / MsfAuthError on failure; callers
 * translate those into DENIED/failed results with redacted messages.
 */
import { type MsfRequestFn } from "./protocol.js";
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
export interface ConsoleRunResult {
    /** Full captured console output (capped by caller). */
    output: string;
    /** True when the console went idle (module finished) before the deadline. */
    completed: boolean;
    /** True when we gave up waiting and destroyed the console. */
    timedOut: boolean;
    /** True when the abort signal fired and we destroyed the console. */
    aborted: boolean;
}
export declare class MsfClient {
    private readonly request;
    private token;
    constructor(request: MsfRequestFn);
    /** Authenticate. Throws MsfAuthError (with setup instructions) on failure. */
    login(user: string, pass: string): Promise<void>;
    /** Raw msfrpc result — a map for most methods, an array for module.search. */
    private callAny;
    private call;
    /**
     * Search the module database. Query uses msf search syntax (cve:, type:, platform:, name:…).
     *
     * msfrpcd returns a BARE ARRAY here (unlike module.exploits, which wraps its
     * results in `{modules:[…]}`). Reading only `res["modules"]` therefore found
     * nothing, so accept either shape — a real daemon sends the array.
     */
    searchModules(query: string): Promise<MsfModule[]>;
    /** Current sessions (id → info). The executor diffs this list around a run: an unregistered newcomer is stopped by hygiene; a Meterpreter run's session is registered from it. */
    sessionList(): Promise<Record<string, Record<string, unknown>>>;
    sessionStop(id: string): Promise<void>;
    /**
     * Write to a live Meterpreter session's command channel (W8 session
     * interaction). Only the session manager calls this, and only for
     * sessions it registered from a validated exploit run.
     */
    sessionMeterpreterWrite(id: string, data: string): Promise<void>;
    /** Drain a Meterpreter session's pending output. Returns "" when idle. */
    sessionMeterpreterRead(id: string): Promise<string>;
    /**
     * Run a module in a throwaway console and capture its output.
     *
     * Flow: console.create → `use <type>/<fullname>` → `set` each option →
     * `set PAYLOAD`/`set CMD` (for exploits with generic payloads) → `run`
     * (foreground, so output streams to the console) → poll console.read
     * until idle/timeout/abort → console.destroy (always).
     *
     * The console is destroyed on abort — that is the call signal for a
     * running module: destroying the console kills whatever it was doing.
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
