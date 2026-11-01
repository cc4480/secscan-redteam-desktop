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
export declare const MSF_ENV_HOST = "REDTEAM_MSFRPC_HOST";
export declare const MSF_ENV_PORT = "REDTEAM_MSFRPC_PORT";
export declare const MSF_ENV_USER = "REDTEAM_MSFRPC_USER";
export declare const MSF_ENV_PASS = "REDTEAM_MSFRPC_PASS";
export declare const MSF_ENV_TLS = "REDTEAM_MSFRPC_TLS";
export declare const MSFRPC_SETUP_INSTRUCTIONS: string;
export interface MsfCredentials {
    host: string;
    port: number;
    useTls: boolean;
    user: string;
    pass: string;
}
/** msfrpcd connection credentials — fail fast with setup instructions. */
export declare function resolveMsfCredentials(env?: NodeJS.ProcessEnv): MsfCredentials;
/** Values that must never appear in logs, errors, or events. */
export declare function msfSecrets(creds: MsfCredentials): string[];
/** True when the payload is a policy-allowed Meterpreter session payload. */
export declare function isMsfSessionPayload(payload: string): boolean;
export declare function checkMsfPayload(payload: string, opts?: {
    testMode?: boolean;
}): string | null;
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
export declare const MSF_SESSION_POST_MODULES: readonly string[];
/** True when the named post module is on the curated session-gather allowlist. */
export declare function isAllowedSessionPostModule(fullname: string): boolean;
/** Refuses dos/destructive modules. Returns the label, or null when allowed. */
export declare function checkMsfModule(fullname: string, moduleType?: string, opts?: {
    testMode?: boolean;
}): string | null;
/** Exported for tests and docs — the mechanical backstop, stated plainly. */
export declare function msfModuleDenyList(): string[];
/**
 * The marker command the bridge runs — built by the RUNNER, never by the
 * agent. Validation is "the module achieved command execution", proven by
 * the canary token echoing back. Also passes the destructive denylist as a
 * second mechanical check (defense in depth on a fixed string).
 */
export declare function buildMarkerCommand(marker: string): {
    command: string;
    refused: string | null;
};
export declare function msfRankWeight(rank: string | undefined): number;
