/**
 * Metasploit module/payload policy — the mechanical backstop for msf_exec.
 *
 * What MAY run through the bridge:
 *  - exploit and auxiliary modules (NOT dos/* — denial of service stays
 *    excluded per standing ROE, no exceptions)
 *  - payloads matching ^cmd/<platform>/generic$ — single benign command
 *    execution; for those the command is ALWAYS exactly
 *    `echo <canary marker>` (built by the executor, never agent-supplied)
 *    and additionally passes the host-exec destructive-command denylist
 *  - Meterpreter session payloads (windows/linux/osx, optional x64/x86
 *    infix, reverse_tcp / reverse_https / bind_tcp) — W8 ruling: a session
 *    may open ONLY as the mechanical follow-through of a validated exploit
 *    run; the executor registers it, validates the runner-built marker
 *    through the session, and logs every session command + response
 *  - the curated post-module allowlist below (credential and browser /
 *    OS-store gathers) — post modules run ONLY against an open session
 *    (SESSION option pinned by the executor), never free-standing
 *
 * What may NEVER run: dos modules, destructive modules (disk wipers,
 * ransomware patterns, formatters), non-Meterpreter session payloads
 * (shell bind/reverse, etc.), and any post module outside the allowlist.
 * All pure functions — tested directly, no network.
 */

import { checkDestructive } from "../host-exec/common.js";

export const MSF_NATIVE_SETUP_INSTRUCTIONS = [
  "The Metasploit arm runs the framework installed on THIS host via msfconsole",
  "(no daemon, no RPC credentials, no network listener). To fix:",
  "  1. Install Metasploit Framework (https://www.metasploit.com/download or your distro package).",
  "  2. Ensure `msfconsole` is on PATH, or set REDTEAM_MSFCONSOLE_BIN to its full path.",
  "  3. Re-run.",
  "",
  "No database is required for module search or single-module execution — the",
  "two things this arm actually calls. db-backed features (db_* workspace",
  "awareness: hosts, services, creds accumulated across runs) are not used by",
  "this arm and nothing persists between console processes.",
].join("\n");

/**
 * Generic command-execution payloads: they run ONE command and open NO
 * session. Meterpreter payloads open a session — allowed ONLY on the
 * exploit-run path, where the executor treats the session as the
 * mechanical follow-through of the validated run (W8). Everything else
 * (shell bind/reverse, etc.) is refused.
 */
const GENERIC_PAYLOAD_RE = /^cmd\/[^/]+\/generic$/;

const SESSION_PAYLOAD_RE =
  /^(?:windows|linux|osx)(?:\/(?:x64|x86))?\/meterpreter\/(?:reverse_tcp|reverse_https|bind_tcp)$/;

/** True when the payload is a policy-allowed Meterpreter session payload. */
export function isMsfSessionPayload(payload: string): boolean {
  return SESSION_PAYLOAD_RE.test((payload ?? "").trim());
}

export function checkMsfPayload(payload: string, opts?: { testMode?: boolean }): string | null {
  // TEST MODE (operator order): payload policy is bypassed entirely.
  if (opts?.testMode) return null;
  const p = (payload ?? "").trim();
  if (!p) return "empty payload";
  if (GENERIC_PAYLOAD_RE.test(p)) return null;
  if (SESSION_PAYLOAD_RE.test(p)) return null;
  return `payload not allowed — only generic single-command payloads (cmd/<platform>/generic) and Meterpreter session payloads (<platform>[/x64]/meterpreter/reverse_tcp|reverse_https|bind_tcp) may run; got ${JSON.stringify(p)}`;
}

/**
 * The ONLY post modules that may run (W8 post-exploitation scope): SAM /
 * hash gathers, cached + LSA secrets, the credential collector, GPP
 * cpasswords, and browser / OS-store credential gathers. Post modules run
 * exclusively through an open session — the executor pins the SESSION
 * option to a runner-registered session, so an allowlisted name alone
 * never reaches a host. Kiwi-class access is NOT a post module: it is the
 * Meterpreter `kiwi` extension, driven through the session channel by the
 * credential-dump tool and sealed the same way.
 */
export const MSF_SESSION_POST_MODULES: readonly string[] = [
  "post/windows/gather/hashdump",
  "post/windows/gather/smart_hashdump",
  "post/windows/gather/cachedump",
  "post/windows/gather/lsa_secrets",
  "post/windows/gather/credentials/credential_collector",
  "post/windows/gather/credentials/gpp",
  "post/windows/gather/enum_chrome",
  "post/multi/gather/firefox_creds",
  "post/multi/gather/ssh_creds",
  "post/linux/gather/hashdump",
];

const SESSION_POST_SET = new Set(MSF_SESSION_POST_MODULES);

/** True when the named post module is on the curated session-gather allowlist. */
export function isAllowedSessionPostModule(fullname: string): boolean {
  return SESSION_POST_SET.has((fullname ?? "").trim());
}

interface ModuleDenyPattern {
  label: string;
  re: RegExp;
}

const MODULE_DENY: ModuleDenyPattern[] = [
  // Denial of service is excluded in every mode, every target — standing ROE.
  { label: "denial-of-service module (T1499 excluded by ROE)", re: /(^|\/)dos(\/|$|_)/i },
  { label: "disk/volume destruction", re: /format|disk_?wipe|wiper|shredder/i },
  { label: "ransomware/cryptolocker pattern", re: /ransom|cryptolocker|cryptowall|locker/i },
  { label: "firmware/boot destruction", re: /firmware|bootkit|mbr_?overwrite/i },
];

/** Refuses dos/destructive modules. Returns the label, or null when allowed. */
export function checkMsfModule(fullname: string, moduleType?: string, opts?: { testMode?: boolean }): string | null {
  const name = (fullname ?? "").trim();
  if (!name) return "empty module name";
  const t = (moduleType ?? "").trim().toLowerCase();
  if (t && t !== "exploit" && t !== "auxiliary" && t !== "post") {
    return `module type not allowed — only exploit/auxiliary modules and allowlisted post modules may run; got ${JSON.stringify(moduleType)}`;
  }
  // Post modules are structural: only the curated session-gather
  // allowlist may run, in every mode (test mode bypasses the denylist
  // below, never this list). The name may arrive with or without the
  // "post/" prefix depending on the caller, so normalize before lookup.
  if (t === "post") {
    const candidate = name.startsWith("post/") ? name : `post/${name}`;
    if (!isAllowedSessionPostModule(candidate)) {
      return `post module not allowed — only the curated session gather posts may run (hashdump/SAM, cachedump, lsa_secrets, credential_collector, gpp, browser/OS-store gathers); got ${JSON.stringify(fullname)}`;
    }
  }
  // TEST MODE (operator order): the module denylist (dos/destructive) is
  // bypassed; the structural validation above (non-empty name, module
  // type) still applies.
  if (!opts?.testMode) {
    for (const d of MODULE_DENY) {
      if (d.re.test(name)) return `module denylist: ${d.label}`;
    }
  }
  return null;
}

/** Exported for tests and docs — the mechanical backstop, stated plainly. */
export function msfModuleDenyList(): string[] {
  return MODULE_DENY.map((d) => d.label);
}

/**
 * The marker command the bridge runs — built by the RUNNER, never by the
 * agent. Validation is "the module achieved command execution", proven by
 * the canary token echoing back. Also passes the destructive denylist as a
 * second mechanical check (defense in depth on a fixed string).
 */
export function buildMarkerCommand(marker: string): { command: string; refused: string | null } {
  const clean = marker.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "REDACTED-MARKER";
  const command = `echo REDTEAM-MARKER-${clean}`;
  return { command, refused: checkDestructive(command) };
}

/** Rank labels msfconsole search reports → numeric weight for sorting. */
const RANK_WEIGHTS: Record<string, number> = {
  excellent: 600,
  great: 500,
  good: 400,
  normal: 300,
  average: 200,
  low: 100,
  manual: 0,
};

export function msfRankWeight(rank: string | undefined): number {
  return RANK_WEIGHTS[(rank ?? "").toLowerCase()] ?? 0;
}
