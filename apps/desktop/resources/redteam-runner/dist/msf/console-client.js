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
import { DEFAULT_CONSOLE_TIMEOUT_MS, runConsoleOnce } from './console.js';
/** One row of the `search` table, as the console prints it. */
const MODULE_ROW = /^\s*(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(Yes|No)\s+(.*)$/;
/**
 * Parse the module table `search <query>` prints.
 *
 * The console prints `#  Full Name  Disclosure Date  Rank  Check  Name`, where the
 * last column is free text that may contain single spaces — so the row is matched
 * field by field rather than split on whitespace.
 * @param output - cleaned console output.
 * @returns one entry per table row; empty when the search found nothing.
 */
export function parseModuleSearch(output) {
    const modules = [];
    for (const line of output.split(/\r?\n/)) {
        const match = MODULE_ROW.exec(line);
        if (match === null)
            continue;
        const [, , fullname, disclosure, rank, , name] = match;
        if (fullname === undefined || name === undefined)
            continue;
        modules.push({
            // The console's full name carries the module type as its first segment.
            type: fullname.split('/')[0] ?? '',
            name: fullname,
            fullname,
            rank: rank ?? '',
            description: name.trim(),
            ...disclosure === undefined || disclosure === '.' ? {} : { disclosureDate: disclosure },
        });
    }
    return modules;
}
/** One row of the `sessions` table, as the console prints it. */
const SESSION_ROW = /^\s*(\d+)\s+(.*)$/;
/**
 * Parse `sessions` output into an id-keyed map, matching `MsfClient.sessionList`.
 * @param output - cleaned console output.
 * @returns the sessions by id; empty when the console reports none.
 */
export function parseSessionList(output) {
    const sessions = {};
    if (/No active sessions/i.test(output))
        return sessions;
    let inTable = false;
    for (const line of output.split(/\r?\n/)) {
        if (/^\s*Id\s+Name\s+Type\s+Information\s+Connection/i.test(line)) {
            inTable = true;
            continue;
        }
        if (!inTable)
            continue;
        const match = SESSION_ROW.exec(line);
        if (match === null)
            continue;
        const [, id, rest] = match;
        if (id === undefined || rest === undefined)
            continue;
        // The Information column is free text; everything after the type is kept
        // verbatim so a session's banner is never silently dropped.
        const fields = rest.trim().split(/\s{2,}/);
        sessions[id] = {
            id,
            name: fields[0] ?? '',
            type: fields[1] ?? '',
            info: fields.slice(2).join('  '),
        };
    }
    return sessions;
}
/**
 * Run a module search through a one-shot console and parse the table.
 * @param binary - the msfconsole executable.
 * @param query - the console search expression, passed through verbatim.
 * @param timeoutMs - boot and execution budget.
 * @returns the run outcome and the modules it listed.
 */
export async function searchModulesViaConsole(binary, query, timeoutMs) {
    const run = await runConsoleOnce(binary, `search ${query}`, timeoutMs);
    return { run, modules: run.ok ? parseModuleSearch(run.output) : [] };
}
/**
 * Run `sessions` through a one-shot console and parse the table.
 * @param binary - the msfconsole executable.
 * @param timeoutMs - boot and execution budget.
 * @returns the run outcome and the sessions it listed.
 */
export async function listSessionsViaConsole(binary, timeoutMs) {
    const run = await runConsoleOnce(binary, 'sessions', timeoutMs);
    return { run, sessions: run.ok ? parseSessionList(run.output) : {} };
}
/**
 * The console-backed module source.
 *
 * Satisfies the same narrow interface as the primary native client, so the search
 * and suggest paths can work through a one-shot console. Each call pays one
 * console boot (about 29 seconds warm) as a native fallback.
 */
export class MsfConsoleModuleSource {
    binary;
    timeoutMs;
    /**
     * @param binary - the msfconsole executable.
     * @param timeoutMs - per-call boot and execution budget.
     */
    constructor(binary, timeoutMs = DEFAULT_CONSOLE_TIMEOUT_MS) {
        this.binary = binary;
        this.timeoutMs = timeoutMs;
    }
    /**
     * List the modules matching a search expression.
     * @param query - the console search expression.
     * @returns the parsed modules.
     * @throws Error when the console run fails, so a caller never reads a failed run as "no matches".
     */
    async searchModules(query) {
        const { run, modules } = await searchModulesViaConsole(this.binary, query, this.timeoutMs);
        if (!run.ok)
            throw new Error(`msfconsole search failed: ${run.failure ?? 'unknown failure'}`);
        return modules;
    }
}
/** Line families the console emits during a module run. */
const RUN_HIT = /^\[\+\]\s+(.*)$/;
const RUN_INFO = /^\[\*\]\s+(.*)$/;
const RUN_FAIL = /^\[-\]\s+(.*)$/;
const RUN_ECHO = /^([A-Za-z0-9_]+)\s+=>\s*(.*)$/;
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
export function parseModuleRun(output) {
    const options = {};
    const hits = [];
    const info = [];
    const failures = [];
    for (const line of output.split(/\r?\n/)) {
        const hit = RUN_HIT.exec(line);
        if (hit?.[1] !== undefined) {
            hits.push(hit[1].trim());
            continue;
        }
        const infoLine = RUN_INFO.exec(line);
        if (infoLine?.[1] !== undefined) {
            info.push(infoLine[1].trim());
            continue;
        }
        const fail = RUN_FAIL.exec(line);
        if (fail?.[1] !== undefined) {
            failures.push(fail[1].trim());
            continue;
        }
        const echo = RUN_ECHO.exec(line);
        if (echo?.[1] !== undefined)
            options[echo[1]] = (echo[2] ?? '').trim();
    }
    return {
        options,
        hits,
        info,
        failures,
        completed: info.some(line => /module execution completed/i.test(line)),
    };
}
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
export async function runAuxiliaryViaConsole(binary, module, sets, timeoutMs) {
    const commands = [
        `use ${module}`,
        ...Object.entries(sets).map(([name, value]) => `set ${name} ${value}`),
        'run',
    ].join('; ');
    const run = await runConsoleOnce(binary, commands, timeoutMs);
    return { run, report: run.ok ? parseModuleRun(run.output) : parseModuleRun('') };
}
//# sourceMappingURL=console-client.js.map