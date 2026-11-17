/**
 * Console fallback for auxiliary module runs.
 *
 * An auxiliary module scans and reports; it opens no session, so a one-shot
 * native `msfconsole -x` can carry it and exit without losing anything. This
 * module is native-only: it never depends on an RPC daemon/credentials and
 * returns `null` only for ineligible cases (exploit/session work or no local
 * console available), so the caller keeps its existing path untouched.
 *
 * It is called AFTER the executor's safety ordering - module denylist, destructive
 * command check, option sanitisation and forced RHOSTS/RHOST from the scope-checked
 * host - so the console receives the same options the regular path would have.
 */
import type { MsfDeps, MsfResult } from './executor-types.js';
/** The arguments that decide eligibility and label the result. */
export interface AuxiliaryConsoleArgs {
    /** The scope-checked host the module runs against. */
    host: string;
    /** Module type; only `auxiliary` is console-eligible. */
    moduleType: 'exploit' | 'auxiliary';
    /** Module path, e.g. `auxiliary/scanner/portscan/tcp`. */
    module: string;
    /** Boot and execution budget. */
    timeoutMs?: number;
}
/**
 * Run an auxiliary module through a one-shot native console when a local console
 * is available. Native-only: no RPC daemon/credentials are considered.
 * @param deps - executor dependencies, including the environment.
 * @param args - host, module and timeout.
 * @param options - already-sanitised datastore options, RHOSTS forced from scope.
 * @returns a result when the console carried the run; `null` when ineligible or unavailable.
 */
export declare function tryAuxiliaryConsole(deps: MsfDeps, args: AuxiliaryConsoleArgs, options: Record<string, string>): Promise<MsfResult | null>;
