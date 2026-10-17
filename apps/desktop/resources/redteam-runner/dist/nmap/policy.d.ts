/**
 * Nmap bridge policy — the mechanical backstop for nmap_exec (v0.31.0).
 *
 * Cloned from the nuclei policy on purpose: same shape, same guarantees. The
 * agent picks a PROFILE and a HOST; it never supplies flags. The argv builder
 * emits only flags it knows, so an unknown field is dropped rather than
 * forwarded, and there is no path from agent input to shell text.
 *
 * What MAY run:
 *  - PROFILE LISTING — reads the built-in profile table, touches no target
 *  - a SCAN of one scope-checked host using a named profile
 *
 * What may NEVER run:
 *  - NSE script categories that are intrusive, exploitative, denial-of-service,
 *    brute-force, fuzzing or external. `--script` is emitted ONLY with the safe
 *    category set, so requesting `exploit` gets refused rather than filtered
 *    silently — an operator should be told no, not handed a quieter scan.
 *  - timing above -T4. -T5 is "insane" and reliably saturates a link; the
 *    rate limiter in the safety core cannot throttle a raw SYN flood, so the
 *    cap lives here where nothing can route around it.
 *  - decoy, spoof, and fragmentation flags: they obscure the source of traffic
 *    the ROE says must be attributable.
 *  - any flag the builder does not know.
 *
 * All pure functions — tested directly, no subprocess.
 */
export declare const NMAP_ENV_BIN = "REDTEAM_NMAP_BIN";
export declare const NMAP_ENV_TIMEOUT = "REDTEAM_NMAP_TIMEOUT_S";
export declare const NMAP_SETUP_INSTRUCTIONS: string;
/** NSE categories that may be selected. Anything else is refused. */
export declare const NMAP_ALLOWED_SCRIPT_CATEGORIES: string[];
/**
 * NSE categories that are refused by name with a reason, so the refusal is
 * legible rather than a generic "unknown category".
 */
export declare const NMAP_DENIED_SCRIPT_CATEGORIES: string[];
export interface NmapProfile {
    /** Operator-facing name. */
    id: string;
    /** What it does, in one line, for the tool description and a refusal message. */
    description: string;
    /** Fixed flags for this profile. Never agent-supplied. */
    args: string[];
    /**
     * Minimum autonomy tier. Port discovery and version detection are recon
     * (Tier 0/1); a full 65535-port sweep and UDP are noisier and slower, so
     * they need the operator to have declared at least Tier 1.
     */
    minTier: number;
}
/**
 * The profile table — this IS the "point and shoot" surface. An operator picks
 * a name, not a flag set, which is what keeps the tool safe to hand to an agent.
 */
export declare const NMAP_PROFILES: readonly NmapProfile[];
export declare const NMAP_PROFILE_IDS: string[];
export declare function findProfile(id: string): NmapProfile | undefined;
/** Resolve the nmap binary — explicit env wins, else PATH lookup. */
export declare function resolveNmapBinary(env?: NodeJS.ProcessEnv): string;
/** Run timeout in seconds — env override, sane default. */
export declare function resolveNmapTimeoutS(env?: NodeJS.ProcessEnv): number;
/**
 * Refuses a script category that is not on the safe list.
 *
 * Refusal, not filtering: silently dropping `exploit` would hand back a scan
 * that looks like it ran what was asked. An operator who asked for an
 * intrusive category must be told it is refused and why.
 */
export declare function checkNmapScriptCategories(categories: string[] | undefined): string | null;
/** Refuses timing above -T4 and any flag on the forbidden list. */
export declare function checkNmapFlags(flags: string[] | undefined): string | null;
export interface NmapRunOptions {
    /** Scope-checked host or CIDR. Never a URL — nmap takes hosts. */
    target: string;
    profile: NmapProfile;
    /** NSE categories, already validated by checkNmapScriptCategories. */
    scriptCategories?: string[];
    /** Requests per second cap, inherited from the engagement safety config. */
    rateLimit: number;
    timeoutS: number;
    /** Restrict the host-discovery step for a single known-up host. */
    skipPing?: boolean;
}
/**
 * Build the nmap argv from structured options — no shell, no interpolation.
 *
 * `--max-rate` carries the engagement's per-host rate limit into nmap itself.
 * The safety core's limiter gates how OFTEN the bridge is invoked; it cannot
 * throttle packets inside a single scan, so the cap has to be handed down.
 */
export declare function buildNmapRunArgv(binary: string, opts: NmapRunOptions): string[];
/** argv for the profile listing — touches no target. */
export declare function buildNmapProfileListArgv(binary: string): string[];
/** Values that must never appear in logs, errors, or events. */
export declare function nmapSecrets(): string[];
