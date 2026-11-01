/**
 * Gate CLI execution and output parsing.
 *
 * The gate runs as a child node process with an argument array only: no
 * shell, and no caller-supplied input — snapshot paths come from
 * discovery (locate.ts) and slugs from the manifest. Output is collected
 * as it streams in; the process is killed at the timeout.
 */
/** The raw outcome of a gate CLI invocation. */
export interface GateCliResult {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    spawnError: string | null;
}
/**
 * Run the gate CLI with an argument array (never a shell). Output is
 * collected as it streams in; the process is killed at the timeout.
 *
 * @param cliPath - the located gate CLI entry (lib/types/cli.js)
 * @param args - subcommand and flags, all derived from discovery/manifest
 * @param timeoutMs - hard timeout; the child is killed past it
 * @param env - optional environment overrides for the child
 * @returns the collected result; never rejects
 */
export declare function runGateCli(cliPath: string, args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<GateCliResult>;
/** One bundle's parsed verify line. */
export interface VerifyRow {
    slug: string;
    ok: boolean;
}
/** Parsed `foundry-gate verify` output. */
export interface VerifyResult {
    rows: VerifyRow[];
    okCount: number | null;
    totalCount: number | null;
}
/**
 * Parse verify stdout: "<slug> OK <hash>" / "<slug> MISMATCH ..." lines and
 * the closing "verified N/M bundles OK" summary.
 *
 * @param stdout - the CLI's stdout
 * @returns the parsed rows and summary counts (null when absent)
 */
export declare function parseVerifyOutput(stdout: string): VerifyResult;
/** One bundle's parsed gate-run row. */
export interface RunRow {
    slug: string;
    passRate: number | null;
    observedTier: number | null;
    assignedTier: number | null;
    fitness: number | null;
    gatePass: boolean | null;
    error: string | null;
}
/**
 * Parse `foundry-gate run` stdout rows: the panel row format printed per
 * bundle, or the ERROR form for a bundle that failed to run.
 *
 * @param stdout - the CLI's stdout
 * @returns the parsed rows in print order
 */
export declare function parseRunOutput(stdout: string): RunRow[];
