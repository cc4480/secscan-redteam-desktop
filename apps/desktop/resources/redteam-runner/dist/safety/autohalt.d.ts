export interface AutoHaltConfig {
    /** Consecutive distress outcomes that halt a target. */
    consecutiveThreshold: number;
    /** Sliding window size for the rate check. */
    windowSize: number;
    /** Failure rate within the window that halts a target (0–1). */
    windowFailureRate: number;
}
export declare const DEFAULT_AUTOHALT_CONFIG: AutoHaltConfig;
export declare class TargetAutoHalt {
    private tracks;
    private cfg;
    /** Total auto-halts this engagement (manifest). */
    halts: number;
    constructor(cfg?: Partial<AutoHaltConfig>);
    private track;
    /**
     * Record one tool outcome for a host. `distress` = the target errored,
     * refused, timed out, or threw 5xx — i.e. the TARGET may be in trouble,
     * as opposed to a clean negative (404, auth denied, vuln absent).
     */
    recordOutcome(host: string, distress: boolean): string | null;
    isHalted(host: string): boolean;
    haltReason(host: string): string | undefined;
    haltedHosts(): string[];
    /** Operator-initiated reset (e.g. after confirming the target recovered). */
    reset(host: string): void;
    get config(): AutoHaltConfig;
}
/**
 * Lockout-signal phrasings (fleet charter spec §6): a target throttling
 * or locking accounts. Exported as ONE shared constant because the
 * credential lockout classifier (safety/lockout.ts) must read exactly
 * the same set — two classifiers with drifting ideas of what a lockout
 * reads like would be a fork, and the Q-LOCKOUT spec (§5.3) forbids it.
 * Tested against lowercased result text.
 */
export declare const LOCKOUT_TEXT_PATTERN: RegExp;
/**
 * Classify a dispatch result as target distress (true) or a clean outcome
 * (false). Distress = the target may be hurt: transport errors, timeouts,
 * connection refusals, 5xx. Clean = 404s, auth denials, vuln-absent, scope
 * denials, policy refusals — the target answered fine. A result carrying
 * the TOOL_TIMEOUT error code is never distress: the timeout is our own
 * tool's, and the machine-readable code outranks any timeout wording in
 * the result text.
 */
export declare function isTargetDistress(result: string, errorCode?: string): boolean;
