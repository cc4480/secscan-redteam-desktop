/** Print the help table for `redteam-runner commands`. */
export declare function printCommandHelp(): void;
/**
 * Run the `command` subcommand.
 * @returns exit code (0 ok, 2 usage, 3 bad invocation, 1 run failure).
 */
export declare function runCommandCli(): Promise<number>;
/** Every command name, for shell completion and docs. */
export declare function commandNames(): readonly string[];
