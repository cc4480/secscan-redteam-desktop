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
import { existsSync } from 'node:fs';
import { resolveMsfConsoleBinary } from '../console.js';
import { runAuxiliaryViaConsole } from '../console-client.js';
/**
 * Run an auxiliary module through a one-shot native console when a local console
 * is available. Native-only: no RPC daemon/credentials are considered.
 * @param deps - executor dependencies, including the environment.
 * @param args - host, module and timeout.
 * @param options - already-sanitised datastore options, RHOSTS forced from scope.
 * @returns a result when the console carried the run; `null` when ineligible or unavailable.
 */
export async function tryAuxiliaryConsole(deps, args, options) {
    // An exploit opens a session; a one-shot console exits and takes it along.
    if (args.moduleType !== 'auxiliary')
        return null;
    const env = deps.env ?? process.env;
    const binary = resolveMsfConsoleBinary(env);
    // Respect an explicit operator-supplied binary path; otherwise require the
    // resolved default/well-known binary to actually exist before taking this path.
    if (env['REDTEAM_MSF_CONSOLE_BIN'] === undefined && !existsSync(binary))
        return null;
    const started = Date.now();
    const { run, report } = await runAuxiliaryViaConsole(binary, args.module, options, args.timeoutMs);
    const ok = run.ok && report.completed;
    const summary = run.ok
        ? `msf console ${args.module} vs ${args.host}: ${report.completed ? 'completed' : 'did not complete'}, ${report.hits.length} hit(s)`
        : `msf console ${args.module} vs ${args.host}: ${run.failure ?? 'failed'}`;
    const output = [
        ...report.hits.map(line => `[+] ${line}`),
        ...report.info.map(line => `[*] ${line}`),
        ...report.failures.map(line => `[-] ${line}`),
    ].join('\n');
    return {
        ok,
        transport: 'msf',
        host: args.host,
        summary,
        output: output === '' ? '(no console output)' : output,
        ms: Date.now() - started,
    };
}
//# sourceMappingURL=auxiliary-console.js.map