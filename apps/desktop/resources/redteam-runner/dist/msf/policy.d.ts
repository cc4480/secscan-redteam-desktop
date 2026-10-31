/**
 * Metasploit module/payload policy — the mechanical backstop for msf_exec.
 *
 * What MAY run through the bridge:
 *  - exploit and auxiliary modules (NOT dos/* — denial of service stays
 *    excluded per standing ROE, no exceptions)
 *  - payloads matching ^cmd/<platform>/generic$ — single benign command
 *    execution, no session, no Meterpreter, no post-exploitation agent
 *  - the command is ALWAYS exactly `echo <canary marker>` (built by the
 *    executor, never agent-supplied) and additionally passes the
 *    host-exec destructive-command denylist
 *
 * What may NEVER run: dos modules, destructive modules (disk wipers,
 * ransomware patterns, formatters), and any non-generic payload.
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
export declare function checkMsfPayload(payload: string): string | null;
/** Refuses dos/destructive modules. Returns the label, or null when allowed. */
export declare function checkMsfModule(fullname: string, moduleType?: string): string | null;
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
