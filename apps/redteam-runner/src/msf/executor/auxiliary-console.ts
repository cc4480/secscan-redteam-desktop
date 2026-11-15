/**
 * Console fallback for auxiliary module runs.
 *
 * An auxiliary module scans and reports; it opens no session, so a one-shot
 * `msfconsole -x` can carry it and exit without losing anything. That is exactly the
 * line between what the console can do and what still needs `msfrpcd`, and this
 * module sits on the safe side of it: it returns `null` for anything else, so the
 * caller keeps its existing daemon path untouched.
 *
 * It is called AFTER the executor's safety ordering - module denylist, destructive
 * command check, option sanitisation and forced RHOSTS/RHOST from the scope-checked
 * host - so the console receives the same options the daemon would have.
 */

import { existsSync } from 'node:fs'
import { resolveMsfConsoleBinary } from '../console.js'
import { runAuxiliaryViaConsole } from '../console-client.js'
import type { MsfDeps, MsfResult } from './executor-types.js'

/** The arguments that decide eligibility and label the result. */
export interface AuxiliaryConsoleArgs {
  /** The scope-checked host the module runs against. */
  host: string
  /** Module type; only `auxiliary` is console-eligible. */
  moduleType: 'exploit' | 'auxiliary'
  /** Module path, e.g. `auxiliary/scanner/portscan/tcp`. */
  module: string
  /** Boot and execution budget. */
  timeoutMs?: number
}

/**
 * Run an auxiliary module through a one-shot console when no daemon is seated.
 * @param deps - executor dependencies, including the environment.
 * @param args - host, module and timeout.
 * @param options - already-sanitised datastore options, RHOSTS forced from scope.
 * @returns a result when the console carried the run; `null` to keep the daemon path.
 */
export async function tryAuxiliaryConsole(
  deps: MsfDeps,
  args: AuxiliaryConsoleArgs,
  options: Record<string, string>,
): Promise<MsfResult | null> {
  // An exploit opens a session; a one-shot console exits and takes it along.
  if (args.moduleType !== 'auxiliary') return null
  const env = deps.env ?? process.env
  const user = (env['REDTEAM_MSFRPC_USER'] ?? '').trim()
  const pass = (env['REDTEAM_MSFRPC_PASS'] ?? '').trim()
  // A seated daemon answers in milliseconds and is the primary path.
  if (user !== '' && pass !== '') return null
  const binary = resolveMsfConsoleBinary(env)
  if (env['REDTEAM_MSF_CONSOLE_BIN'] === undefined && !existsSync(binary)) return null

  const started = Date.now()
  const { run, report } = await runAuxiliaryViaConsole(binary, args.module, options, args.timeoutMs)
  const ok = run.ok && report.completed
  const summary = run.ok
    ? `msf console ${args.module} vs ${args.host}: ${report.completed ? 'completed' : 'did not complete'}, ${report.hits.length} hit(s)`
    : `msf console ${args.module} vs ${args.host}: ${run.failure ?? 'failed'}`
  const output = [
    ...report.hits.map(line => `[+] ${line}`),
    ...report.info.map(line => `[*] ${line}`),
    ...report.failures.map(line => `[-] ${line}`),
  ].join('\n')
  return {
    ok,
    transport: 'msf',
    host: args.host,
    summary,
    output: output === '' ? '(no console output)' : output,
    ms: Date.now() - started,
  }
}
