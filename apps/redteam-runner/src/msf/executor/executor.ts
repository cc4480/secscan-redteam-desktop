/**
 * MsfExecutor — the runner's Metasploit bridge, behind the safety core.
 * (Module doc comment preserved on the msf/executor.ts barrel.)
 *
 * Preflight order (mirrors host-exec/executor.ts):
 *   1. ROE scope check (exact hostname match, fail closed, before any packet)
 *   2. module/payload policy (dos + destructive modules refused; generic
 *      single-command payloads run the runner-built canary marker, which
 *      additionally passes the destructive denylist; Meterpreter payloads
 *      open a session — see 6)
 *   4. credential resolution (REDTEAM_MSFRPC_* env/Secure Vault only, fail
 *      fast with setup instructions)
 *   5. execution with timeout + abort signal; the console is destroyed on
 *      abort (the call signal is what stops a running module)
 *   6. session hygiene: a generic-payload validation run must not leave
 *      sessions behind — any session that wasn't there before is stopped
 *      immediately. A Meterpreter-payload run is the one exception (W8):
 *      the session it produces is registered as the mechanical
 *      follow-through of the validated run (executor/session-ops.ts) and
 *      stays open under a runner-issued handle
 *   7. redaction of every secret from every string that leaves
 *
 * The request function is injectable so tests run against a fake msfrpcd.
 */

import { capOutput, checkDestructive, redactSecrets, validateHostTarget } from '../../host-exec/common.js'
import { type MsfRequestFn } from '../protocol.js'
import { MsfAuthError } from '../client.js'
import {
  buildMarkerCommand,
  checkMsfModule,
  checkMsfPayload,
  isMsfSessionPayload,
} from '../policy.js'
import { MsfSessionManager } from '../sessions.js'
import { authedClient } from './auth.js'
import {
  closeSession as closeMsfSession,
  finishSessionRun,
  sessionCommand as runSessionCommand,
  type SessionCloseArgs,
  type SessionCommandArgs,
} from './session-ops.js'
import { credentialDump as runCredentialDump, type CredentialDumpArgs } from './credential-dump.js'
import { MSF_TIMEOUT_MS } from './executor-types.js'
import type { MsfDeps, MsfResult } from './executor-types.js'
import { msfSearch, msfSuggest, type MsfSearchArgs, type MsfSuggestArgs } from './executor-query.js'

// The public shapes live in executor-types.ts (file-budget split); re-exported
// here so the msf barrel and every importer keep the same surface.
export { MSF_TIMEOUT_MS } from './executor-types.js'
export type { MsfDeps, MsfResult } from './executor-types.js'

export class MsfExecutor {
  readonly deps: { request?: MsfRequestFn; env: NodeJS.ProcessEnv; endpoint?: { host: string; port: number; useTls: boolean } }
  /** TEST MODE: policy checks bypassed (see MsfDeps.testMode). */
  readonly testMode: boolean
  /** Live Meterpreter sessions opened by validated runs on this executor (W8). */
  readonly sessions = new MsfSessionManager()
  constructor(deps: MsfDeps = {}) {
    this.deps = { request: deps.request, env: deps.env ?? process.env, endpoint: deps.endpoint }
    this.testMode = deps.testMode === true
  }

  refusedResult(host: string, refused: string, secrets: string[] = []): MsfResult {
    return {
      ok: false,
      transport: 'msf',
      host,
      summary: redactSecrets(`REFUSED: ${refused}`, secrets),
      output: '',
      ms: 0,
      refused: redactSecrets(refused, secrets),
    }
  }

  preflight(host: string, scopeHosts: string[]): { secrets: string[] } | { refused: string } {
    const v = validateHostTarget(host, scopeHosts)
    if (!v.ok) return { refused: v.reason }
    return { secrets: [] }
  }

  /**
   * Search the module database (recon-safe: no module runs).
   * `query` uses msf search syntax; when omitted, `cve`/`service` build it.
   * The body lives in executor-query.ts (file-budget split).
   */
  async search(args: MsfSearchArgs): Promise<MsfResult> {
    return msfSearch(this, args)
  }

  /**
   * Recon → module mapping: detected service/version → ranked candidate
   * modules. The candidates go to the COORDINATOR for approval — this tool
   * never fires an exploit. That approval is the recon→exploit sign-off
   * the coordinator already owns. The body lives in executor-query.ts.
   */
  async suggest(args: MsfSuggestArgs): Promise<MsfResult> {
    return msfSuggest(this, args)
  }

  /**
   * Run ONE module. With a generic cmd payload, the only payload action is
   * the benign canary marker: `echo REDTEAM-MARKER-<id>` echoing back IS
   * the validation ("command execution achieved"). With a Meterpreter
   * session payload (W8), the session the run produces is registered and
   * the same marker is proven through the session — the session opens as
   * the mechanical follow-through of the validated run, never before it.
   * No destructive modules in either path.
   */
  async run(args: {
    host: string
    scopeHosts: string[]
    moduleType: 'exploit' | 'auxiliary'
    module: string
    /** Module datastore options (RHOSTS etc. derived from host — secrets never in here). */
    options?: Record<string, string>
    payload?: string
    /** Canary id echoed by the marker command (runner-generated upstream). */
    marker: string
    timeoutMs?: number
    signal?: AbortSignal
  }): Promise<MsfResult> {
    const started = Date.now()
    const pre = this.preflight(args.host, args.scopeHosts)
    if ('refused' in pre) return this.refusedResult(args.host, pre.refused)
    // Policy first — before credentials, before any packet to msfrpcd.
    // TEST MODE: module/payload policy and the canary destructive check
    // are bypassed (structural module validation inside checkMsfModule
    // still applies); dispatch/msf.ts logs the would-be denials.
    const deniedModule = checkMsfModule(args.module, args.moduleType, { testMode: this.testMode })
    if (deniedModule) return this.refusedResult(args.host, deniedModule)
    const payload = args.payload ?? (args.moduleType === 'exploit' ? 'cmd/unix/generic' : undefined)
    if (payload) {
      const deniedPayload = checkMsfPayload(payload, { testMode: this.testMode })
      if (deniedPayload) return this.refusedResult(args.host, deniedPayload)
    }
    const { command: markerCmd, refused: deniedCmd } = buildMarkerCommand(args.marker)
    if (deniedCmd) return this.refusedResult(args.host, `marker command refused: ${deniedCmd}`)
    // The marker is fixed, but run it through the destructive denylist
    // anyway — defense in depth on the one command we ever fire.
    const denied = this.testMode ? null : checkDestructive(markerCmd)
    if (denied) return this.refusedResult(args.host, `destructive-command denylist: ${denied}`)
    try {
      const { client, secrets } = await authedClient(this.deps, MSF_TIMEOUT_MS, args.signal)
      const before = new Set(Object.keys(await client.sessionList()))
      const timeoutMs = args.timeoutMs ?? MSF_TIMEOUT_MS
      const options: Record<string, string> = { ...(args.options ?? {}) }
      // Strip agent-supplied target selectors; RHOSTS/RHOST always come from
      // the scope-checked host — never agent-supplied (closes auxiliary bypass).
      for (const k of Object.keys(options)) {
        if (/^rhosts?$/i.test(k) || /^targets?$/i.test(k)) delete options[k]
      }
      // RHOSTS always comes from the scope-checked host — never agent-supplied.
      // Forcing it (rather than only filling it when absent) closes the path
      // where an agent supplies its own RHOSTS and points the module at a host
      // that never passed preflight's validateHostTarget.
      options['RHOSTS'] = args.host
      options['RHOST'] = args.host
      const res = await client.runModuleConsole({
        moduleType: args.moduleType,
        fullname: args.module,
        options,
        payload,
        cmd: payload ? markerCmd : undefined,
        timeoutMs,
        signal: args.signal,
      })
      // W8: a Meterpreter payload's session is the mechanical
      // follow-through of this validated run — register it and prove the
      // marker through it instead of hygiene-stopping it.
      if (payload && isMsfSessionPayload(payload)) {
        return finishSessionRun(this, {
          client,
          secrets,
          before,
          console: res,
          targetHost: args.host,
          module: args.module,
          payload,
          marker: args.marker,
          markerCmd,
          timeoutMs,
          signal: args.signal,
          started,
        })
      }
      // Session hygiene: validation must not leave sessions behind.
      const after = await client.sessionList().catch(() => ({}))
      const strays = Object.keys(after).filter(id => !before.has(id))
      for (const id of strays) {
        await client.sessionStop(id).catch(() => undefined)
      }
      const markerHit = res.output.includes('REDTEAM-MARKER-')
      const verdict = res.aborted
        ? 'ABORTED by call signal (console destroyed)'
        : res.timedOut
          ? 'timed out (console destroyed)'
          : markerHit
            ? 'MARKER ECHOED — command execution validated'
            : 'completed without marker echo'
      return {
        ok: !res.aborted && !res.timedOut && markerHit,
        transport: 'msf',
        host: args.host,
        summary: redactSecrets(
          `msf ${args.moduleType}/${args.module} vs ${args.host}: ${verdict}` +
            (strays.length > 0 ? ` — ${strays.length} stray session(s) stopped (hygiene)` : ''),
          secrets,
        ),
        output: redactSecrets(capOutput(res.output), secrets),
        ms: Date.now() - started,
      }
    } catch (err) {
      const msg = (err as Error).message
      const refused =
        err instanceof MsfAuthError || msg.includes('unreachable') ? msg : `msf run failed: ${msg}`
      return {
        ok: false,
        transport: 'msf',
        host: args.host,
        summary: refused.slice(0, 300),
        output: '',
        ms: Date.now() - started,
        refused: err instanceof MsfAuthError ? refused : undefined,
      }
    }
  }

  /** Run ONE command through a session a validated run opened (W8). See executor/session-ops.ts. */
  async sessionCommand(args: SessionCommandArgs): Promise<MsfResult> {
    return runSessionCommand(this, args)
  }

  /** Close a session a validated run opened (W8). See executor/session-ops.ts. */
  async sessionClose(args: SessionCloseArgs): Promise<MsfResult> {
    return closeMsfSession(this, args)
  }

  /** Dump credential material through an open session, sealed to evidence (W8). See executor/credential-dump.ts. */
  async credentialDump(args: CredentialDumpArgs): Promise<MsfResult> {
    return runCredentialDump(this, args)
  }
}
