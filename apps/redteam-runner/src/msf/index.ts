/**
 * Metasploit arm (v0.11.0 lineage) — the runner's CVE-specific exploit arm,
 * executing the Metasploit Framework installed on THIS host natively
 * (local msfconsole processes; no daemon, no RPC, no credentials).
 *
 * The battery covers technique CLASSES (ATT&CK-mapped). Metasploit
 * brings the ~2,000 CVE-SPECIFIC exploits the battery can't hardcode. The
 * arm closes that gap WITHOUT hardcoding CVEs: recon detects a
 * service/version → suggestModules maps it to candidate modules →
 * the coordinator approves → run() fires ONE module: with a generic
 * payload the benign canary marker is the only payload action; with a
 * Meterpreter session payload the run's session opens as its mechanical
 * follow-through (marker proven through the session), and session_command /
 * credential_dump / session_close act through that registered session.
 *
 * Every call goes through the same discipline as host-exec: scope,
 * exact-hostname ROE scope, module/payload denylists, timeouts, session
 * hygiene, secret redaction.
 */

export { MsfExecutor, MSF_TIMEOUT_MS } from "./executor.js";
export type { MsfDeps, MsfResult } from "./executor.js";
export { LocalMsfClient, MsfAuthError, parseMsfSearchOutput, MSF_CONSOLE_QUIET_MS, _resetMsfRuntimeForTests } from "./local-client.js";
export type { MsfModule, ModuleSearchSource, ConsoleRunResult, MsfConsoleProcess, MsfSpawnFn } from "./local-client.js";
export { msfBinaryPresent, resolveMsfConsoleCommand, _resetMsfProbeCache } from "./prereq.js";
export {
  checkMsfPayload,
  checkMsfModule,
  msfModuleDenyList,
  buildMarkerCommand,
  msfRankWeight,
  isMsfSessionPayload,
  isAllowedSessionPostModule,
  MSF_SESSION_POST_MODULES,
  MSF_NATIVE_SETUP_INSTRUCTIONS,
} from "./policy.js";
export { MsfSessionManager } from "./sessions.js";
export type { MsfSessionRecord } from "./sessions.js";
export { DUMP_KINDS, dumpKindNames, countCredentialRecords } from "./executor/credential-dump.js";
export type { DumpKindSpec } from "./executor/credential-dump.js";
export { extractCves, buildModuleQueries, filterAndRank, suggestModules, CVE_RE } from "./suggest.js";
export type { SuggestInput, RankedModule } from "./suggest.js";
