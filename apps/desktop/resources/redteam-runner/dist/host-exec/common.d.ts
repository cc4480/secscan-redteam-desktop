/**
 * host-exec safety core — every host tool (ssh/smb/winrm) goes through this.
 *
 * The runner — not the model — enforces the hard boundaries. The model's
 * prompts already forbid destructive behavior; this module is the MECHANICAL
 * backstop: scope checks, a destructive-command denylist, credential hygiene,
 * timeouts, and output caps. All of it fails closed.
 *
 * Scope model (deliberate, differs from the web prober on purpose): the web
 * prober rejects private/loopback hosts because its URLs are derived from
 * scan targets (SSRF-pivot risk). Host-exec targets come from the
 * operator-DECLARED ROE scope — the operator explicitly listed these hosts,
 * and internal pentests legitimately target RFC1918 space. So the check is:
 * the host must EXACTLY match a declared scope host (case-insensitive).
 * Anything else is rejected before any packet is sent.
 */
export declare const HOST_EXEC_TIMEOUT_MS = 30000;
export declare const HOST_OUTPUT_CAP: number;
/** Scope check: exact match against the engagement's declared scope hosts. */
export declare function validateHostTarget(host: string, scopeHosts: string[]): {
    ok: true;
} | {
    ok: false;
    reason: string;
};
/**
 * Returns the matched denylist label, or null when the command is allowed.
 * Pure function — tested directly, no network.
 */
export declare function checkDestructive(command: string): string | null;
/** Exported for tests and docs — the mechanical backstop, stated plainly. */
export declare function destructiveDenyList(): string[];
export interface HostCredentials {
    username: string;
    password?: string;
    privateKey?: string;
    domain?: string;
    /**
     * NT hash (32 hex chars) for pass-the-hash — the test account's OWN hash,
     * provided by the client. Handled with the same secrecy as a password.
     */
    ntHash?: string;
}
/** SSH credentials: REDTEAM_SSH_USER + one of PASSWORD / KEY / KEY_PATH. */
export declare function resolveSshCredentials(env?: NodeJS.ProcessEnv): HostCredentials;
/** SMB credentials: REDTEAM_SMB_USER + REDTEAM_SMB_PASSWORD (+ optional DOMAIN). */
export declare function resolveSmbCredentials(env?: NodeJS.ProcessEnv): HostCredentials;
/** WinRM credentials: REDTEAM_WINRM_USER + REDTEAM_WINRM_PASSWORD. */
export declare function resolveWinrmCredentials(env?: NodeJS.ProcessEnv): HostCredentials;
/**
 * SMB pass-the-hash credentials: REDTEAM_SMB_USER + REDTEAM_SMB_NTHASH.
 * The hash is the test account's OWN NTLM hash, provided by the client —
 * never dumped, never another principal's material. Strict 32-hex validation.
 */
export declare function resolveSmbHashCredentials(env?: NodeJS.ProcessEnv): HostCredentials;
/**
 * AD/LDAP credentials: dedicated REDTEAM_AD_* when set, otherwise the SMB
 * test-account credentials (same authorized test account, documented fallback).
 */
export declare function resolveAdCredentials(env?: NodeJS.ProcessEnv): HostCredentials;
/** Values that must never appear in logs, errors, or events. */
export declare function collectSecrets(creds: HostCredentials): string[];
/** Redact every secret occurrence. Applied to ALL strings leaving this module. */
export declare function redactSecrets(text: string, secrets: string[]): string;
/** Truncate to the output cap (no bulk exfiltration through the tool). */
export declare function capOutput(text: string, cap?: number): string;
/** One-line audit summary of a command (redacted, capped). */
export declare function summarizeCommand(command: string, secrets: string[]): string;
