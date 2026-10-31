/**
 * External-tool bridge registry (v0.32.0).
 *
 * john, sqlmap, ffuf, gobuster and nikto are all the same shape: a binary, a
 * fixed set of named profiles, and refusals that must happen BEFORE the process
 * starts. Cloning the nuclei/nmap module five times would be five copies of the
 * same policy logic and five places for it to drift, so the per-tool differences
 * live here as data and one executor drives all of them.
 *
 * The contract is the one the earlier bridges established:
 *   - the agent picks a PROFILE and a TARGET, never a flag
 *   - the argv is built runner-side, so nothing from the model reaches a shell
 *   - a refusal names the reason and is returned as a result, not swallowed
 *   - destructive and denial-of-service behaviour is refused by construction
 *
 * All pure functions — tested directly, no subprocess.
 */
export type XToolId = "john" | "sqlmap" | "ffuf" | "gobuster" | "nikto";
export interface XProfile {
    id: string;
    description: string;
    /** Minimum autonomy tier. Anything that can break or lock something is >= 1. */
    minTier: number;
    /** Extra argv appended after the tool's base flags. Never agent-supplied. */
    args: string[];
    /**
     * Where the target goes FOR THIS PROFILE. It is per-profile, not per-tool,
     * because one tool's modes disagree: john's --list=formats reads no file at
     * all while its cracking modes need the hash file. A tool-level flag made
     * identify fail on a path it should never have received.
     */
    target?: "flag" | "positional" | "none";
    /** This profile needs the configured wordlist. Per-profile for the same reason. */
    wordlist?: boolean;
    /** Pass the wordlist as --wordlist=<path> rather than -w <path>. */
    wordlistEq?: boolean;
}
export interface XToolSpec {
    id: XToolId;
    /** Env var that overrides the binary path. */
    envBin: string;
    envDir?: string;
    /** What the tool is for, in one line, for the tool description. */
    purpose: string;
    /** Command prefix: argv[0] plus any interpreter. */
    command: (bin: string) => string[];
    /** Named profiles. The first is the default. */
    profiles: XProfile[];
    /** Where the target goes: appended, or substituted into a profile arg. */
    targetFlag?: string;
    /** Output is JSON that the executor should parse. */
    jsonOutput?: boolean;
    setup: string[];
}
/**
 * Every tool here can be pointed at a host the operator does not own, so the
 * scope check in the dispatch layer is the load-bearing control — not anything
 * in this file. What this file adds is that the COMMAND cannot be bent: no
 * `--os-shell`, no rules file that writes back, no wordlist the agent supplied
 * as a path traversal.
 */
export declare const XTOOLS: readonly XToolSpec[];
export declare const XTOOLS_BY_ID: Map<XToolId, XToolSpec>;
export declare function findXTool(id: string): XToolSpec | undefined;
/** The default profile for a tool — its first entry. */
export declare function defaultProfile(spec: XToolSpec): XProfile;
export declare function findProfile(spec: XToolSpec, id: string): XProfile | undefined;
/**
 * Flags no profile may ever emit, whatever the agent asks for.
 *
 * These are the ones that turn a scanner into something that changes the target
 * or hides the attacker. `--os-shell` and `--os-cmd` hand over a shell; `--file-write`
 * writes to the target's filesystem; the rest obscure or exfiltrate. A bridge
 * that can be argued into emitting one of these is not a scanner.
 */
export declare const XTOOL_DENIED_FLAGS: string[];
/** Refuses any denied flag in an agent-supplied list. Returns the reason or null. */
export declare function checkXToolFlags(flags: string[] | undefined): string | null;
export interface XRunOptions {
    bin: string;
    dir?: string;
    target: string;
    profile: XProfile;
    wordlist?: string;
    /** Per-run ceiling in seconds, inherited from the safety config. */
    timeoutS: number;
}
/**
 * Build the argv. No shell, no interpolation, and the target goes LAST so a
 * value beginning with "-" cannot be read as a flag.
 */
export declare function buildXToolArgv(spec: XToolSpec, opts: XRunOptions): string[];
