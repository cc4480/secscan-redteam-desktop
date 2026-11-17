/**
 * Shared msfconsole runtime — the process/session state behind
 * LocalMsfClient (local-client.ts).
 *
 * Sessions live INSIDE the msfconsole process that opened them and cannot
 * cross framework instances, while the executor constructs one client per
 * operation — so all process/session state is held by the module-level
 * runtime below and client instances are thin facades over it. Session
 * state therefore survives across client constructions.
 */
import type { MsfModule } from "./local-client.js";
/** The minimal child-process surface the client drives — injectable for tests. */
export interface MsfConsoleProcess {
    write(data: string): void;
    onData(cb: (chunk: string) => void): void;
    kill(): void;
    readonly exited: Promise<number | null>;
}
export type MsfSpawnFn = (bin: string, argv: string[]) => MsfConsoleProcess;
/** Default spawner: the real msfconsole, stderr merged into the data stream. */
export declare const defaultMsfSpawn: MsfSpawnFn;
/** Quiet period after which a console counts as idle (module finished). */
export declare const MSF_CONSOLE_QUIET_MS = 1500;
export declare const MAX_BUFFER: number;
export declare const sleep: (ms: number) => Promise<void>;
/**
 * Every value written to a console becomes part of a newline-delimited
 * command stream, so CR/LF and command separators in an agent-supplied
 * module name or option value would inject extra console commands. Strip
 * them (the retired RPC console's rule, kept verbatim).
 */
export declare const cleanConsoleValue: (s: string) => string;
export interface SessionRecord {
    daemonId: string;
    type: string;
}
export interface ProcRecord {
    proc: MsfConsoleProcess;
    buffer: string;
    sessions: Map<string, SessionRecord>;
    interactingDaemonId: string | null;
    dead: boolean;
}
interface Runtime {
    daemonCounter: number;
    procs: Set<ProcRecord>;
    probeOk: boolean;
}
export declare const msfRuntime: Runtime;
/** Test-only: forget every process, session, and the cached probe. */
export declare function _resetMsfRuntimeForTests(): void;
/** Register a spawned process in the shared runtime and start capturing its output. */
export declare function attachProcess(proc: MsfConsoleProcess): ProcRecord;
/** Locate the process + console session id owning a runtime session id. */
export declare function findProcByDaemon(daemonId: string): {
    rec: ProcRecord;
    msfId: string;
} | null;
/**
 * Capture a process's output from `startLen` (a buffer offset the caller
 * snapshots BEFORE writing its commands — output can arrive synchronously
 * with the write) until it goes quiet, the deadline hits, or the signal aborts.
 */
export declare function captureQuiet(rec: ProcRecord, startLen: number, deadlineMs: number, signal?: AbortSignal): Promise<{
    output: string;
    aborted: boolean;
    timedOut: boolean;
}>;
/** One-shot run of the binary; collects output until exit or timeout. Never registered in the runtime. */
export declare function runOnce(bin: string, spawnFn: MsfSpawnFn, argv: string[], timeoutMs: number): Promise<{
    code: number | null;
    output: string;
}>;
/**
 * Parse `msfconsole search` table output into modules. Rows look like:
 * `0  exploit/windows/smb/ms17_010_eternalblue  2017-03-14  excellent  Yes  MS17-010 …`.
 * The table's Name column carries the type prefix; the module shape used
 * across this arm keeps `fullname` prefix-less (type separate), matching
 * what the retired RPC search returned. Header, separator, and non-row
 * lines are skipped. Exported for tests.
 * @param text - raw console output of a search run.
 * @returns the parsed modules, in table order.
 */
export declare function parseMsfSearchOutput(text: string): MsfModule[];
/** Return a process's console to its prompt when a session interaction is open on it. */
export declare function ensureBackgrounded(rec: ProcRecord): Promise<void>;
export {};
