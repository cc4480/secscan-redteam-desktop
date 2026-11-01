/**
 * `redteam-runner arsenal` — the operator CLI for the Arsenal index
 * (spec §9). One subcommand, `refresh [--force-clone]`, delegating to
 * the one refresh code path in `src/arsenal/refresh.ts` — the console
 * timer is that same path's other trigger, and no MCP tool can reach
 * either: refresh is an operator action, permanently (spec §3).
 */
import { type RefreshDeps } from '../arsenal/refresh.js';
/**
 * Run the arsenal CLI and return the process exit code for the caller
 * (`main()` in cli/commands.ts) to adopt: 0 when the refresh swapped a
 * new generation in, 1 when it failed (the old generation keeps
 * serving; the printed summary says so), 2 on a usage error or a
 * misconfigured REDTEAM_ARSENAL_* variable (the error names it).
 *
 * @param argv - Arguments after `arsenal` (defaults to the process argv tail).
 * @param env - Environment the config resolves from (injectable for tests).
 * @param deps - Refresh seams (git runner / build entry), injectable for tests.
 * @returns The exit code.
 */
export declare function runArsenalCli(argv?: readonly string[], env?: NodeJS.ProcessEnv, deps?: Partial<RefreshDeps>): Promise<number>;
