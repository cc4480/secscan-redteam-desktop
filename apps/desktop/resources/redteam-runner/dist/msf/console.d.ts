/**
 * Native msfconsole transport: one command per invocation.
 *
 * Measured on a real Metasploit 6.5.3-dev install (Windows, `C:\metasploit`):
 *
 *  - `msfconsole -q -x "<cmd>; exit"` works and is the ONLY viable form here.
 *  - A persistent console driven over stdin does NOT work: writing commands
 *    before the prompt loses them, and writing them after `msf >` appears is
 *    ignored too. Two probes established that, so this module does not pretend
 *    a long-lived session is available.
 *  - Startup cost is real: 147s on the first run of an install (database and gem
 *    initialisation) and ~29s warm. Every command therefore pays that boot, which
 *    is what the timeout handling below is sized for.
 *  - The Windows entry point is a `.bat`, and Node cannot spawn one directly
 *    (`spawn EINVAL`); it has to go through `cmd.exe /c`.
 *
 * Consequently this one-shot native console transport pays a console boot per
 * command, rather than amortizing startup across calls as a long-lived process
 * would. It remains useful as a simple native fallback path.
 */
/** Default warm-startup budget, generously above the measured ~29s. */
export declare const DEFAULT_CONSOLE_TIMEOUT_MS = 180000;
/** Outcome of one console command. */
export interface ConsoleRunResult {
    /** Whether the command produced output and exited without a timeout. */
    readonly ok: boolean;
    /** Console output with ANSI escapes removed. */
    readonly output: string;
    /** Process exit code, or undefined when it was killed. */
    readonly code?: number;
    /** Set when the run timed out or failed to spawn. */
    readonly failure?: string;
}
/** Strip ANSI SGR sequences and Ruby's deprecation chatter from console output. */
export declare function cleanConsoleOutput(raw: string): string;
/**
 * Resolve the msfconsole executable.
 * @param env - process environment; `REDTEAM_MSF_CONSOLE_BIN` wins when set.
 * @returns the configured path, the first well-known Windows path that exists, or `msfconsole`.
 */
export declare function resolveMsfConsoleBinary(env: NodeJS.ProcessEnv): string;
/**
 * Run ONE command through `msfconsole -q -x` and return its output.
 *
 * The command is joined into the `-x` script followed by `exit`, so the console
 * always terminates; a command that leaves an interactive prompt (an exploit that
 * opens a session) therefore ends when the console does, which suits the
 * one-shot read model.
 * @param binary - executable path, normally from {@link resolveMsfConsoleBinary}.
 * @param command - the msfconsole command line, e.g. `use auxiliary/scanner/portscan/tcp; show options`.
 * @param timeoutMs - boot and execution budget; see {@link DEFAULT_CONSOLE_TIMEOUT_MS}.
 * @returns the captured output and how the run ended.
 */
export declare function runConsoleOnce(binary: string, command: string, timeoutMs?: number): Promise<ConsoleRunResult>;
