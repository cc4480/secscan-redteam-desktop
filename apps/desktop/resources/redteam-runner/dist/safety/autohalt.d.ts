/**
 * Auto-halt (v0.13.0) — the production safety case.
 *
 * If a target starts erroring, refusing connections, or throwing 5xxs, the
 * runner must NOT keep hammering it — that is how "testing" becomes "outage".
 * The existing global guard halts the whole engagement on three consecutive
 * 5xxs; this module is the per-target version buyers ask for:
 *
 *  - N consecutive target-distress outcomes (default 5), OR
 *  - a failure rate >= 50% over the last 20 outcomes (default window),
 *  → the target is HALTED: further tool calls to it are refused before any
 *    packet, a `target_auto_halt` event is appended, and the halt is named
 *    in the safety manifest + report. Other in-scope targets continue.
 *
 * "Target distress" is classified by the caller (dispatch passes an explicit
 * boolean), not regex-guessed here — the classifier lives next to the tools.
 */
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
 * Classify a dispatch result as target distress (true) or a clean outcome
 * (false). Distress = the target may be hurt: transport errors, timeouts,
 * connection refusals, 5xx. Clean = 404s, auth denials, vuln-absent, scope
 * denials, policy refusals — the target answered fine.
 */
export declare function isTargetDistress(result: string): boolean;
