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
export const DEFAULT_AUTOHALT_CONFIG = {
    consecutiveThreshold: 5,
    windowSize: 20,
    windowFailureRate: 0.5,
};
export class TargetAutoHalt {
    tracks = new Map();
    cfg;
    /** Total auto-halts this engagement (manifest). */
    halts = 0;
    constructor(cfg = {}) {
        this.cfg = { ...DEFAULT_AUTOHALT_CONFIG, ...cfg };
    }
    track(host) {
        let t = this.tracks.get(host);
        if (!t) {
            t = { consecutive: 0, window: [], halted: false };
            this.tracks.set(host, t);
        }
        return t;
    }
    /**
     * Record one tool outcome for a host. `distress` = the target errored,
     * refused, timed out, or threw 5xx — i.e. the TARGET may be in trouble,
     * as opposed to a clean negative (404, auth denied, vuln absent).
     */
    recordOutcome(host, distress) {
        const t = this.track(host);
        if (t.halted)
            return t.haltReason ?? "already halted";
        if (distress) {
            t.consecutive++;
        }
        else {
            t.consecutive = 0;
        }
        t.window.push(distress);
        if (t.window.length > this.cfg.windowSize)
            t.window.shift();
        const rate = t.window.filter(Boolean).length / t.window.length;
        let reason = null;
        if (t.consecutive >= this.cfg.consecutiveThreshold) {
            reason = `${t.consecutive} consecutive target-distress outcomes (possible WAF block, service degradation, or outage)`;
        }
        else if (t.window.length >= this.cfg.windowSize && rate >= this.cfg.windowFailureRate) {
            reason = `${Math.round(rate * 100)}% distress rate over the last ${t.window.length} outcomes`;
        }
        if (reason) {
            t.halted = true;
            t.haltReason = reason;
            this.halts++;
            return reason;
        }
        return null;
    }
    isHalted(host) {
        return this.tracks.get(host)?.halted ?? false;
    }
    haltReason(host) {
        return this.tracks.get(host)?.haltReason;
    }
    haltedHosts() {
        return [...this.tracks.entries()].filter(([, t]) => t.halted).map(([h]) => h);
    }
    /** Operator-initiated reset (e.g. after confirming the target recovered). */
    reset(host) {
        this.tracks.delete(host);
    }
    get config() {
        return { ...this.cfg };
    }
}
/**
 * Classify a dispatch result as target distress (true) or a clean outcome
 * (false). Distress = the target may be hurt: transport errors, timeouts,
 * connection refusals, 5xx. Clean = 404s, auth denials, vuln-absent, scope
 * denials, policy refusals — the target answered fine.
 */
export function isTargetDistress(result) {
    const r = result.toLowerCase();
    if (/^halted\b/.test(r))
        return false; // our own halt, not target distress
    return (/probe failed|connection refused|timed out|timeout|econnreset|econnrefused|enotfound|socket hang up/.test(r) ||
        /http 5\d\d/.test(r) ||
        /\b5\d\d\b.*(error|from target)/.test(r));
}
//# sourceMappingURL=autohalt.js.map