/** Why a run can still show 0 tokens: it made no model call (never estimated). */
export const TOKEN_CAPTURE_STATUS = "captured: agents.ts agentLoop records every ChatResult.usage into the per-engagement meter and captureEngagementTrajectory sums it; 0 means no model response happened (or the run predates the P1 meter) - never an estimate";
/** Explicit zeroes-with-reason; the default when no response was recorded. */
export const ZERO_TOKEN_TOTALS = { tokensIn: 0, tokensOut: 0, responses: 0 };
function nonNegativeInt(value) {
    return value !== undefined && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}
/** Create the accumulator to install on the llm-router path. */
export function createTokenMeter() {
    let tokensIn = 0;
    let tokensOut = 0;
    let responses = 0;
    return {
        record(usage) {
            if (usage === undefined)
                return;
            tokensIn += nonNegativeInt(usage.promptTokens);
            tokensOut += nonNegativeInt(usage.completionTokens);
            responses++;
        },
        get totals() {
            return { tokensIn, tokensOut, responses };
        },
    };
}
/**
 * Per-engagement token meters. Keyed by the run's Ctx so two engagements in
 * one process never share a counter, and no module-global total exists.
 */
const metersByEngagement = new WeakMap();
/** The token meter for one engagement context; created on first use. */
export function tokenMeterFor(owner) {
    const existing = metersByEngagement.get(owner);
    if (existing !== undefined)
        return existing;
    const meter = createTokenMeter();
    metersByEngagement.set(owner, meter);
    return meter;
}
/** Tool families whose dispatched events are tool calls. */
const TOOL_PREFIX = /^(scan_|probe_|http_|burst_|nmap_|nuclei_|msf_|john_|sqlmap_|ffuf_|gobuster_|nikto_|ssh_|smb_|winrm_|rdp_|ad_|krb_|nfs_|xtool_|browser_)/;
/** Tools without a family prefix: the bookkeeping / verdict tools. */
const TOOL_NAMES = new Set([
    "query_registry",
    "update_target_map",
    "record_finding",
    "record_killed",
    "record_item_verdict",
    "variant_list",
    "abort_engagement",
]);
/**
 * True when the event is a tool invocation: a known tool name/family prefix, or
 * the event carried an ATT&CK technique (only tool dispatches set attackId).
 */
export function isToolAction(action, attackId) {
    return attackId !== undefined || TOOL_PREFIX.test(action) || TOOL_NAMES.has(action);
}
/** Normalize the runner's EngagementEvent[] into contract TrajectoryEvent[]. */
export function toTrajectoryEvents(events) {
    return events.map((event) => ({
        ts: event.ts,
        phase: event.phase,
        actor: event.actor,
        action: event.action,
        ...(event.attackId !== undefined ? { attackId: event.attackId } : {}),
        ...(event.target !== undefined ? { target: event.target } : {}),
        result: event.result,
        isToolCall: isToolAction(event.action, event.attackId),
    }));
}
//# sourceMappingURL=trajectory-normalize.js.map