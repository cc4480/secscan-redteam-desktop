/**
 * Parsing `msfconsole` output into the shapes `MsfClient` already returns.
 *
 * Every fixture in the tests is output recorded from the real console on this
 * machine (Metasploit 6.5.3-dev), not invented text: a parser tuned to imagined
 * output would pass its own tests and fail the first live call.
 *
 * Two output families are covered here, the read-only ones:
 *  - `search <query>` prints a fixed-width module table.
 *  - `sessions` prints either "No active sessions." or a session table.
 */
import type { ModuleSearchSource, MsfModule } from './local-client.js';
import { type ConsoleRunResult } from './console.js';
/**
 * Parse the module table `search <query>` prints.
 *
 * The console prints `#  Full Name  Disclosure Date  Rank  Check  Name`, where the
 * last column is free text that may contain single spaces — so the row is matched
 * field by field rather than split on whitespace.
 * @param output - cleaned console output.
 * @returns one entry per table row; empty when the search found nothing.
 */
export declare function parseModuleSearch(output: string): MsfModule[];
/**
 * Parse `sessions` output into an id-keyed map, matching `MsfClient.sessionList`.
 * @param output - cleaned console output.
 * @returns the sessions by id; empty when the console reports none.
 */
export declare function parseSessionList(output: string): Record<string, Record<string, unknown>>;
/** A run of one console command, with its parsed result. */
export interface ConsoleSearchResult {
    /** The raw run outcome, so a caller can distinguish "no results" from "failed". */
    readonly run: ConsoleRunResult;
    /** Parsed modules. */
    readonly modules: MsfModule[];
}
/**
 * Run a module search through a one-shot console and parse the table.
 * @param binary - the msfconsole executable.
 * @param query - the console search expression, passed through verbatim.
 * @param timeoutMs - boot and execution budget.
 * @returns the run outcome and the modules it listed.
 */
export declare function searchModulesViaConsole(binary: string, query: string, timeoutMs?: number): Promise<ConsoleSearchResult>;
/**
 * Run `sessions` through a one-shot console and parse the table.
 * @param binary - the msfconsole executable.
 * @param timeoutMs - boot and execution budget.
 * @returns the run outcome and the sessions it listed.
 */
export declare function listSessionsViaConsole(binary: string, timeoutMs?: number): Promise<{
    run: ConsoleRunResult;
    sessions: Record<string, Record<string, unknown>>;
}>;
/**
 * The console-backed module source.
 *
 * Satisfies the same narrow interface as the primary native client, so the search
 * and suggest paths can work through a one-shot console. Each call pays one
 * console boot (about 29 seconds warm) as a native fallback.
 */
export declare class MsfConsoleModuleSource implements ModuleSearchSource {
    private readonly binary;
    private readonly timeoutMs;
    /**
     * @param binary - the msfconsole executable.
     * @param timeoutMs - per-call boot and execution budget.
     */
    constructor(binary: string, timeoutMs?: number);
    /**
     * List the modules matching a search expression.
     * @param query - the console search expression.
     * @returns the parsed modules.
     * @throws Error when the console run fails, so a caller never reads a failed run as "no matches".
     */
    searchModules(query: string): Promise<MsfModule[]>;
}
/** What one module run printed. */
export interface ModuleRunReport {
    /** `set` echoes, keyed by option name, in the order the console printed them. */
    readonly options: Record<string, string>;
    /** Successful observations (`[+]`), verbatim. */
    readonly hits: string[];
    /** Progress and status lines (`[*]`), verbatim. */
    readonly info: string[];
    /** Refusals and errors (`[-]`), verbatim. */
    readonly failures: string[];
    /** Whether the console reported the module finishing rather than aborting. */
    readonly completed: boolean;
}
/**
 * Parse the output of `use <module>; set …; run`.
 *
 * The four line families are distinct markers the console prints itself, so the
 * parser keys on the marker rather than on column positions — module output is
 * free-form after the marker. Recorded from a real run: a miss prints only the
 * `[*]` progress and completion lines; a hit adds a `[+]` line such as
 * `127.0.0.1 - 127.0.0.1:135 - TCP OPEN`.
 * @param output - cleaned console output.
 * @returns the run's echoes, hits, progress, refusals, and completion flag.
 */
export declare function parseModuleRun(output: string): ModuleRunReport;
/**
 * Run an auxiliary module through a one-shot console and parse its output.
 *
 * Auxiliary modules are the console-safe case: they scan and report, and they do
 * not open a session, so nothing needs to survive the console's exit. An exploit
 * module does open one, which is why module EXECUTION that returns a session still
 * requires the daemon.
 * @param binary - the msfconsole executable.
 * @param module - module path, e.g. `auxiliary/scanner/portscan/tcp`.
 * @param sets - options to set before running, e.g. `{ RHOSTS: '127.0.0.1' }`.
 * @param timeoutMs - boot and execution budget.
 * @returns the run outcome and the parsed report.
 */
export declare function runAuxiliaryViaConsole(binary: string, module: string, sets: Record<string, string>, timeoutMs?: number): Promise<{
    run: ConsoleRunResult;
    report: ModuleRunReport;
}>;
