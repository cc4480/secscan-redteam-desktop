import type { Harness2Store } from "./store-model.js";
export interface CliIo {
    readonly out: (line: string) => void;
    readonly err: (line: string) => void;
}
/** Positional arguments and `--flag value` / `--flag=value` options. */
interface ParsedArgs {
    readonly positionals: readonly string[];
    readonly flags: ReadonlyMap<string, string>;
}
export declare function runIngestCommand(store: Harness2Store, parsed: ParsedArgs, io: CliIo): number;
export declare function runIngestRootCommand(store: Harness2Store, parsed: ParsedArgs, io: CliIo): number;
export declare function runListCommand(store: Harness2Store, parsed: ParsedArgs, io: CliIo): number;
export declare function runGetCommand(store: Harness2Store, parsed: ParsedArgs, io: CliIo): number;
export declare function runStatsCommand(store: Harness2Store, parsed: ParsedArgs, io: CliIo): number;
/** Dispatch one command line. Returns the process exit code; never exits the process itself. */
export declare function dispatchCli(argv: readonly string[], io?: CliIo, environment?: NodeJS.ProcessEnv): number;
export {};
