/**
 * Shared types for the target-specific attack batteries (v0.7.0).
 *
 * The batteries are exhaustive: every distinct attacker intent against each
 * target's real surface is one item. Prompts inject a COMPACT checklist
 * (id + name + one-line brief); the full `what` stays in-module as the
 * execution detail the agents expand per item.
 */
import type { BatteryCategory } from "../battery.js";
export type TargetId = "secscan" | "seclayer" | "windows" | "linux";
export declare const FULL_BATTERY_TARGETS: TargetId[];
/** Guard for user-supplied target ids (--targets, probe args). */
export declare function isTargetId(s: string): s is TargetId;
/** Battery id prefixes per target: SS-*, SL-*, WS-*, LX-*. */
export declare const TARGET_PREFIXES: Record<TargetId, string>;
/**
 * The promised battery size per target — the CONTRACT, and the single source
 * of truth for every "N items" statement (prompts, reports, docs). The
 * item-ledger test asserts each profile's actual `battery.length` equals the
 * number here, so adding or removing an item fails loudly until this constant
 * is consciously updated. Do not reference a raw count anywhere else.
 */
export declare const BATTERY_ITEM_COUNTS: Record<TargetId, number>;
/** Total promised battery size — derived, so it can never drift from the parts. */
export declare const TOTAL_BATTERY_ITEMS: number;
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
export declare const HOST_EXEC_TOOLING = "host-exec tooling";
/**
 * Narrower v0.10.0 prerequisites — these items EXECUTE when the prerequisite
 * is met (they are not plan-only). The report lists them with their marker
 * so the operator knows exactly what to supply.
 */
export declare const NEEDS_KERBEROS_TICKET = "kerberos ticket material";
export declare const NEEDS_HUMAN_OPERATOR = "human operator";
export declare const NEEDS_PRIVILEGED_CLIENT = "privileged test client";
/**
 * v0.11.0 prerequisite: the operator's Metasploit RPC daemon
 * (REDTEAM_MSFRPC_USER/PASS). CVE exploit-validation items execute when
 * msfrpcd is reachable; otherwise they report under Honest limits.
 */
export declare const NEEDS_MSFRPCD = "msfrpcd";
/**
 * v0.21.0 prerequisite: the operator's Nuclei binary + template checkout
 * (REDTEAM_NUCLEI_BIN or nuclei on PATH). Template-bridge items execute
 * when the binary is present; otherwise they report under Honest limits.
 */
export declare const NEEDS_NUCLEI = "nuclei binary";
export interface TargetBatteryItem {
    /** SS-001… / SL-001… — unique per target, zero-padded, ordered by surface. */
    id: string;
    category: BatteryCategory;
    name: string;
    /** One-line summary — this is what the coordinator sees in the prompt checklist. */
    brief: string;
    owasp: string;
    /** ATT&CK technique ID where one honestly fits; otherwise undefined. */
    attackId?: string;
    /** What to test — concrete: the actual endpoint/flow/param and the exact abuse. */
    what: string;
    /** Stealth-weighted variant for black-team mode. */
    blackNote?: string;
    /** Prerequisites, stated honestly (e.g. "Second test account", "Canary/OAST infra"). */
    needs?: string;
    /** Why this item is deferred rather than tested (set instead of pretending). */
    deferredReason?: string;
}
export type TargetKind = "webapp" | "mcp-api" | "host-windows" | "host-linux";
export interface TargetProfile {
    id: TargetId;
    name: string;
    baseUrl: string;
    kind: TargetKind;
    /** How the target authenticates callers — the trust boundary under test. */
    authModel: string;
    scopeNotes: string;
    battery: TargetBatteryItem[];
}
