/**
 * MsfExecutor — the runner's Metasploit bridge, behind the safety core.
 *
 * Preflight order (mirrors host-exec/executor.ts):
 *  *   2. ROE scope check (exact hostname match, fail closed, before any packet)
 *   3. module/payload policy (dos + destructive modules refused; generic
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
 *      follow-through of the validated run and stays open under a
 *      runner-issued handle
 *   7. redaction of every secret from every string that leaves
 *
 * The request function is injectable so tests run against a fake msfrpcd.
 */
export { MsfExecutor, MSF_TIMEOUT_MS } from "./executor/executor.js";
export type { MsfDeps, MsfResult } from "./executor/executor.js";
