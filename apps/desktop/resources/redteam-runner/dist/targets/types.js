/**
 * Shared types for the target-specific attack batteries (v0.7.0).
 *
 * The batteries are exhaustive: every distinct attacker intent against each
 * target's real surface is one item. Prompts inject a COMPACT checklist
 * (id + name + one-line brief); the full `what` stays in-module as the
 * execution detail the agents expand per item.
 */
/**
 * The four targets a FULL-BATTERY engagement covers by default. These are the
 * vendor's own surfaces plus the two host families. The v0.35.0 `webapp`
 * family (WA-*, a generic client web application) is deliberately NOT in this
 * default set: it is selected explicitly with --targets webapp (or the
 * start_engagement `targets` argument), because against secscan.us/seclayer.app
 * the generic webapp battery would duplicate the SS-* / SL-* work.
 */
export const FULL_BATTERY_TARGETS = ["secscan", "seclayer", "windows", "linux"];
/** Every target a caller may select, including the opt-in generic webapp family. */
export const ALL_TARGETS = [...FULL_BATTERY_TARGETS, "webapp"];
/** Guard for user-supplied target ids (--targets, probe args). */
export function isTargetId(s) {
    return ALL_TARGETS.includes(s.toLowerCase());
}
/** Battery id prefixes per target: SS-*, SL-*, WA-*, WS-*, LX-*. */
export const TARGET_PREFIXES = {
    secscan: "SS",
    seclayer: "SL",
    webapp: "WA",
    windows: "WS",
    linux: "LX",
};
/**
 * The promised battery size per target — the CONTRACT, and the single source
 * of truth for every "N items" statement (prompts, reports, docs). The
 * item-ledger test asserts each profile's actual `battery.length` equals the
 * number here, so adding or removing an item fails loudly until this constant
 * is consciously updated. Do not reference a raw count anywhere else.
 */
export const BATTERY_ITEM_COUNTS = {
    secscan: 120,
    seclayer: 80,
    webapp: 144,
    windows: 108,
    linux: 110,
};
/** Total promised battery size — derived, so it can never drift from the parts. */
export const TOTAL_BATTERY_ITEMS = FULL_BATTERY_TARGETS.reduce((n, t) => n + BATTERY_ITEM_COUNTS[t], 0);
/**
 * Marker for battery items the runner could not execute even WITH the host-exec
 * tools (v0.9.0): anything needing interactive sessions (RDP GUI), active
 * network attacks (relay/spoofing), Kerberos protocol operations, binary
 * tooling deployment (BloodHound collectors), or AD CS/RDS role tooling.
 * Such items are PLAN-ONLY — the agents plan the hypothesis and expected
 * evidence, and the coverage cell reports BLOCKED (under Honest limits)
 * instead of covered or failed.
 *
 * v0.10.0: no battery item uses this marker anymore — every former
 * plan-only item is now executable or carries a narrower prerequisite below.
 * The constant stays for backward compatibility (reports, saved state).
 */
export const HOST_EXEC_TOOLING = "host-exec tooling";
/**
 * Narrower v0.10.0 prerequisites — these items EXECUTE when the prerequisite
 * is met (they are not plan-only). The report lists them with their marker
 * so the operator knows exactly what to supply.
 */
export const NEEDS_KERBEROS_TICKET = "kerberos ticket material";
export const NEEDS_HUMAN_OPERATOR = "human operator";
export const NEEDS_PRIVILEGED_CLIENT = "privileged test client";
/**
 * v0.11.0 prerequisite: the operator's Metasploit RPC daemon
 * (REDTEAM_MSFRPC_USER/PASS). CVE exploit-validation items execute when
 * msfrpcd is reachable; otherwise they report under Honest limits.
 */
export const NEEDS_MSFRPCD = "msfrpcd";
/**
 * v0.21.0 prerequisite: the operator's Nuclei binary + template checkout
 * (REDTEAM_NUCLEI_BIN or nuclei on PATH). Template-bridge items execute
 * when the binary is present; otherwise they report under Honest limits.
 */
export const NEEDS_NUCLEI = "nuclei binary";
//# sourceMappingURL=types.js.map