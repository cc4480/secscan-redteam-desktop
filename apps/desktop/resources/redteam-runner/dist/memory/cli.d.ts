/**
 * Memory CLI handlers (brief §2.1), dispatched from `src/cli/commands.ts`:
 *
 *   redteam-runner memory status
 *   redteam-runner memory diff show <diffId>
 *   redteam-runner memory approve <diffId> --operator <name> [--ops <opId,...>] [--note "<text>"]
 *   redteam-runner memory apply <diffId>
 *   redteam-runner memory reject <diffId> --operator <name> [--note "<text>"]
 *   redteam-runner memory reindex
 *
 * Handlers return `{ code, lines }` instead of printing, so they are
 * testable without a process. Approval is a named-human act (§7.3):
 * there is no agent tool and no console button for it, by design.
 */
export interface MemoryCliResult {
    code: number;
    lines: string[];
}
/**
 * Resolve the memory root for CLI use: `--memory-root` override →
 * `REDTEAM_MEMORY_ROOT` → sibling of the registry file (the §3.1 rule,
 * resolved the same way `phases/config.ts` resolves the registry path —
 * memory CLI ops are operator tooling and never gate on a model key).
 * An empty-string env value is a misconfiguration and fails loud.
 *
 * @param env - The process environment.
 * @param override - The `--memory-root` flag value, when given.
 * @returns The memory root path.
 */
export declare function resolveMemoryRootFromEnv(env: NodeJS.ProcessEnv, override?: string): string;
/**
 * Run one `memory` subcommand.
 *
 * @param argv - Arguments after `memory` (process.argv.slice(3)).
 * @param env - The process environment (root resolution).
 * @param nowIso - Timestamp for mutations and receipts.
 * @returns The exit code and the lines to print.
 */
export declare function runMemoryCommand(argv: string[], env: NodeJS.ProcessEnv, nowIso: string): MemoryCliResult;
