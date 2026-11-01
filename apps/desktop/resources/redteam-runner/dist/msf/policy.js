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
export const MSF_ENV_HOST = "REDTEAM_MSFRPC_HOST";
export const MSF_ENV_PORT = "REDTEAM_MSFRPC_PORT";
export const MSF_ENV_USER = "REDTEAM_MSFRPC_USER";
export const MSF_ENV_PASS = "REDTEAM_MSFRPC_PASS";
export const MSF_ENV_TLS = "REDTEAM_MSFRPC_TLS";
export const MSFRPC_SETUP_INSTRUCTIONS = [
    "msfrpcd is unreachable. The Metasploit bridge needs Metasploit's RPC daemon:",
    "  1. Install Metasploit Framework (https://www.metasploit.com/download or your distro package).",
    "  2. Start the daemon: msfrpcd -P <rpc-password> -U msf -a 127.0.0.1 -p 55553 -S",
    "     (-S = SSL; keep it on loopback unless you know what you're doing.)",
    "  3. Set REDTEAM_MSFRPC_USER / REDTEAM_MSFRPC_PASS (and optionally",
    "     REDTEAM_MSFRPC_HOST / REDTEAM_MSFRPC_PORT / REDTEAM_MSFRPC_TLS) in the",
    "     environment or Secure Vault, then re-run.",
    "",
    "The DAEMON RUNS WITHOUT A DATABASE, which is enough for module search and",
    "single-module execution — the two things this bridge actually calls. What is",
    "missing without one is db_* awareness: hosts, services, creds, vulns and notes",
    "found during a run are not persisted, so nothing accumulates across sessions",
    "and `db.hosts` errors with 'Unknown API Call: rpc_hosts' because there is no",
    "workspace to read.",
    "",
    "To attach one, point MSF_DATABASE_CONFIG at a database.yml before starting",
    "msfrpcd. The database must carry the FRAMEWORK schema:",
    "  a. Point database.yml at an EMPTY database the msfrpcd user owns. Reusing a",
    "     Metasploit Pro database does NOT work — its schema lacks tables the",
    "     Framework needs, and the Pro role usually cannot create them.",
    "  b. Build the schema: rake db:migrate   (run from the framework root with",
    "     BUNDLE_GEMFILE set). 164 migrations is a complete 6.5 schema.",
    "  c. Start msfrpcd with MSF_DATABASE_CONFIG set, then create the workspace",
    "     once via the RPC: db.add_workspace('default').",
    "  d. Verify with db.status — it must report your database name, and the",
    "     startup log must NOT say 'No database support'.",
    "Note: `loot` does not exist in Metasploit 6.5 — neither the table nor the RPC",
    "endpoint — so db.loot failing is expected there and not a setup fault.",
].join("\n");
/** msfrpcd connection credentials — fail fast with setup instructions. */
export function resolveMsfCredentials(env = process.env) {
    const host = env[MSF_ENV_HOST]?.trim() || "127.0.0.1";
    const portRaw = env[MSF_ENV_PORT]?.trim();
    const port = portRaw ? Number(portRaw) : 55553;
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`[msf] ${MSF_ENV_PORT} must be a TCP port number, got ${JSON.stringify(portRaw)}.`);
    }
    const useTls = (env[MSF_ENV_TLS]?.trim() ?? "1") !== "0";
    const user = env[MSF_ENV_USER]?.trim();
    const pass = env[MSF_ENV_PASS];
    if (!user || !pass) {
        throw new Error(`[msf] missing msfrpcd credentials: set ${MSF_ENV_USER} and ${MSF_ENV_PASS} in the environment or Secure Vault.\n${MSFRPC_SETUP_INSTRUCTIONS}`);
    }
    return { host, port, useTls, user, pass };
}
/** Values that must never appear in logs, errors, or events. */
export function msfSecrets(creds) {
    return creds.pass && creds.pass.length >= 4 ? [creds.pass] : [];
}
/**
 * Generic command-execution payloads: they run ONE command and open NO
 * session. Meterpreter payloads open a session — allowed ONLY on the
 * exploit-run path, where the executor treats the session as the
 * mechanical follow-through of the validated run (W8). Everything else
 * (shell bind/reverse, etc.) is refused.
 */
const GENERIC_PAYLOAD_RE = /^cmd\/[^/]+\/generic$/;
const SESSION_PAYLOAD_RE = /^(?:windows|linux|osx)(?:\/(?:x64|x86))?\/meterpreter\/(?:reverse_tcp|reverse_https|bind_tcp)$/;
/** True when the payload is a policy-allowed Meterpreter session payload. */
export function isMsfSessionPayload(payload) {
    return SESSION_PAYLOAD_RE.test((payload ?? "").trim());
}
export function checkMsfPayload(payload, opts) {
    // TEST MODE (operator order): payload policy is bypassed entirely.
    if (opts?.testMode)
        return null;
    const p = (payload ?? "").trim();
    if (!p)
        return "empty payload";
    if (GENERIC_PAYLOAD_RE.test(p))
        return null;
    if (SESSION_PAYLOAD_RE.test(p))
        return null;
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
export const MSF_SESSION_POST_MODULES = [
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
export function isAllowedSessionPostModule(fullname) {
    return SESSION_POST_SET.has((fullname ?? "").trim());
}
const MODULE_DENY = [
    // Denial of service is excluded in every mode, every target — standing ROE.
    { label: "denial-of-service module (T1499 excluded by ROE)", re: /(^|\/)dos(\/|$|_)/i },
    { label: "disk/volume destruction", re: /format|disk_?wipe|wiper|shredder/i },
    { label: "ransomware/cryptolocker pattern", re: /ransom|cryptolocker|cryptowall|locker/i },
    { label: "firmware/boot destruction", re: /firmware|bootkit|mbr_?overwrite/i },
];
/** Refuses dos/destructive modules. Returns the label, or null when allowed. */
export function checkMsfModule(fullname, moduleType, opts) {
    const name = (fullname ?? "").trim();
    if (!name)
        return "empty module name";
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
            if (d.re.test(name))
                return `module denylist: ${d.label}`;
        }
    }
    return null;
}
/** Exported for tests and docs — the mechanical backstop, stated plainly. */
export function msfModuleDenyList() {
    return MODULE_DENY.map((d) => d.label);
}
/**
 * The marker command the bridge runs — built by the RUNNER, never by the
 * agent. Validation is "the module achieved command execution", proven by
 * the canary token echoing back. Also passes the destructive denylist as a
 * second mechanical check (defense in depth on a fixed string).
 */
export function buildMarkerCommand(marker) {
    const clean = marker.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "REDACTED-MARKER";
    const command = `echo REDTEAM-MARKER-${clean}`;
    return { command, refused: checkDestructive(command) };
}
/** Rank labels msfrpcd reports → numeric weight for sorting. */
const RANK_WEIGHTS = {
    excellent: 600,
    great: 500,
    good: 400,
    normal: 300,
    average: 200,
    low: 100,
    manual: 0,
};
export function msfRankWeight(rank) {
    return RANK_WEIGHTS[(rank ?? "").toLowerCase()] ?? 0;
}
//# sourceMappingURL=policy.js.map