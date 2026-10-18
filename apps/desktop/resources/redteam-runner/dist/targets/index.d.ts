/**
 * Target profiles + target-specific attack batteries (v0.8.0).
 *
 * Generic batteries test "a webapp". These batteries test THESE targets
 * against their REAL surfaces:
 *  - SecScan (scanner webapp, 120 items) + SecLayer (MCP/API layer, 80 items)
 *  - Windows host + AD (100+ items) + Linux host (100+ items)
 *  - Webapp (v0.36.0, WA-*, 144 items): a GENERIC client web application,
 *    opt-in with --targets webapp / start_engagement targets. This is the
 *    customer-facing family: it encodes the SecScan + Seclayer scan corpus
 *    (see docs/webapp-battery.md) rather than the two products' own surfaces.
 *
 * Target-specific beats generic because the same flaw class lands
 * differently on each surface: IDOR on a scan report is not IDOR on a
 * shopping cart; privesc on Windows is not privesc on Linux. Every item
 * names the actual endpoint, flow, mechanism, or parameter.
 *
 * FULL_BATTERY unified engagement: one operation, all selected targets, one
 * report — recon all → per-target exploit batteries → cross-cutting chains
 * → unified report. Coverage counts complete only when every selected
 * target × category cell is probed OR honestly blocked (3 × 4 = 12 cells).
 *
 * HONEST EXECUTION SCOPING (v0.9.0): the runner's host-exec tools
 * (`ssh_exec`, `smb_exec`, `winrm_exec` in runner/src/host-exec/) execute
 * the Windows/Linux batteries through the safety core (scope, denylist,
 * timeouts, audit). Host items that need MORE than non-interactive command
 * execution / SMB listing still carry needs:"host-exec tooling" and are
 * PLAN-ONLY: the agents write the hypothesis and expected evidence, and the
 * cell reports BLOCKED under Honest limits (never covered, never failed).
 * Items executable via http_probe (HTTP banner/TLS/headers on host web
 * ports) carry no marker and count toward their cells normally.
 * See docs/ROADMAP.md for the delivered host-exec track.
 *
 * Non-destructive always: never trigger emails to real users, never delete
 * scans/reports, benign canary content only, races are single paired
 * requests, credential testing against authorized test accounts only.
 * Items that need prerequisites say so in `needs` — honestly, never
 * pretending a test ran when its setup was missing.
 */
import type { BatteryCategory } from "../battery.js";
import type { TargetBatteryItem, TargetId, TargetKind, TargetProfile } from "./types.js";
import { ALL_TARGETS, BATTERY_ITEM_COUNTS, FULL_BATTERY_TARGETS, HOST_EXEC_TOOLING, NEEDS_HUMAN_OPERATOR, NEEDS_KERBEROS_TICKET, NEEDS_MSFRPCD, NEEDS_NUCLEI, NEEDS_PRIVILEGED_CLIENT, TARGET_PREFIXES, TOTAL_BATTERY_ITEMS, isTargetId } from "./types.js";
export type { TargetBatteryItem, TargetId, TargetKind, TargetProfile };
export { ALL_TARGETS, BATTERY_ITEM_COUNTS, FULL_BATTERY_TARGETS, HOST_EXEC_TOOLING, NEEDS_HUMAN_OPERATOR, NEEDS_KERBEROS_TICKET, NEEDS_MSFRPCD, NEEDS_NUCLEI, NEEDS_PRIVILEGED_CLIENT, TARGET_PREFIXES, TOTAL_BATTERY_ITEMS, isTargetId };
export declare const TARGET_PROFILES: Record<TargetId, TargetProfile>;
export declare function lookupTargetProfile(id: string): TargetProfile | undefined;
/**
 * Selected targets for a full-battery engagement. Defaults to the four vendor
 * targets; --targets narrows the subset or opt in the generic webapp family
 * (e.g. --targets webapp for a client web application, or
 * --targets webapp,windows for a client app plus its Windows host).
 */
export declare function activeTargets(input: {
    targets?: TargetId[];
}): TargetId[];
export declare function targetItemsFor(profile: TargetProfile, category: BatteryCategory): TargetBatteryItem[];
/**
 * Every distinct ATT&CK technique ID used across all batteries (v0.12.0) —
 * the compliance module maps each of these to controls, and the test
 * suite asserts zero unmapped IDs. Items without an attackId are skipped
 * (the mapping is technique-keyed; findings without ATT&CK IDs carry no
 * control mapping, honestly).
 */
export declare function allBatteryAttackIds(): string[];
/**
 * Infer which target a probe URL belongs to: the MCP path is SecLayer, the two
 * vendor hostnames are their own batteries, and every other web host is the
 * generic client-webapp battery (WA-*). Host targets are never inferred - they
 * need an explicit tag.
 */
export declare function inferTargetProfile(url: string): TargetId;
/**
 * A coverage cell is BLOCKED when the runner cannot execute any of its
 * items: every item in that target+category carries a `needs` prerequisite
 * the operator has not met, and no probe was tagged for the cell. Blocked
 * cells are reported under Honest limits — never counted as covered, never
 * counted as failed. (v0.10.0: no cell is fully blocked; the mechanic stays
 * for future batteries.)
 */
export declare function targetCellBlocked(profile: TargetProfile, category: BatteryCategory): boolean;
export type CellStatus = "done" | "blocked" | "missing";
/** Cell status for one target × category. */
export declare function targetCellStatus(profile: TargetProfile, category: BatteryCategory, probed: Set<BatteryCategory> | undefined): CellStatus;
/**
 * Compact checklist for one target's battery, for prompt injection.
 * 400+ items can't ship with full detail — every item appears as
 * ID + name + one-line brief, grouped by category. The full `what`
 * stays in-module; agents expand per item as they work it.
 */
export declare function targetBatteryChecklistText(profile: TargetProfile, mode: "red" | "black"): string;
/** Selected targets' batteries, for the full-battery plan skeleton. */
export declare function fullBatteryChecklistText(mode: "red" | "black", targets?: TargetId[]): string;
/**
 * The unified engagement plan skeleton — one operation, all selected
 * targets, one report. The coordinator expands this into the operation
 * plan; the runner enforces the coverage rule mechanically.
 */
export declare function fullBatteryPlanSkeleton(targets?: TargetId[]): string;
