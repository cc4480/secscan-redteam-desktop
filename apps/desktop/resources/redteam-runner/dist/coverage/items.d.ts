/**
 * Per-item verdict tracking for the full battery (v0.18.0).
 *
 * The coverage contract used to be cell-level (3 categories × selected
 * targets = 12 cells): a cell could report "done" while individual battery
 * items inside it had never been attempted. This module closes that gap
 * mechanically: every selected battery item (418 static items across the
 * four target profiles, plus dynamic per-CVE runtime instances from
 * msf_exec) carries exactly one disposition per engagement, and the battery
 * may not report complete while any item is still `pending`.
 *
 * Dispositions: pending (not attempted) · confirmed (validated finding) ·
 * executed-clean (executed, no finding) · killed (ruled out — negative
 * intelligence, class stays in play) · blocked (prerequisite unmet, named) ·
 * na (not applicable WITH evidence).
 *
 * Transition rules (mechanical, enforced here — not by prompt):
 * pending/blocked → any non-final; executed-clean → confirmed/killed/na;
 * confirmed/killed/na are FINAL except via reverify (remediated → pending);
 * "na" requires evidence text. The ledger is append-only: dispositions move
 * toward terminal, never backwards, except the reverify reopen path.
 */
import type { BatteryCategory } from "../battery.js";
import type { TargetId } from "../targets/index.js";
import type { VariantProgress } from "../variants/types.js";
export type ItemDisposition = "pending" | "confirmed" | "executed-clean" | "killed" | "blocked" | "na";
export interface ItemVerdict {
    /** "secscan:SS-001" for static items, "cve:CVE-2021-44228" for dynamic CVE instances. */
    key: string;
    /** TargetId for static items, "cve" for dynamic instances. */
    target: string;
    /** "SS-001" or "CVE-2021-44228". */
    itemId: string;
    category: BatteryCategory;
    name: string;
    disposition: ItemDisposition;
    /** Required for na/killed/blocked — the evidence or prerequisite. */
    reason?: string;
    decidedAt?: string;
    /** Audit-log seq of the event that decided it (when known). */
    auditSeq?: number;
    /**
     * v0.20.0 variant expansion progress (set by variant_list). While open
     * and unexhausted, the variant tracker owns this item's disposition.
     */
    variants?: VariantProgress;
}
/**
 * Resolve an agent-supplied battery item reference to a ledger key.
 * Accepts "SS-042" (+ optional targetProfile), "secscan:SS-042",
 * "cve:CVE-2021-44228". Returns undefined when the reference does not
 * identify a real battery item — the caller must surface that, never
 * silently drop it.
 */
export declare function resolveItemKey(raw: string, _targetProfile?: string): string | undefined;
/**
 * Whether a battery item's `needs` prerequisite is satisfied right now.
 * Checked from the environment — the honest, mechanical reading. Unknown
 * prerequisites (free text like "Second test account") and the human
 * operator are never auto-met: those items start blocked.
 */
export declare function prerequisiteMet(needs: string): boolean;
/** Build the opening ledger: every selected item pending, except items whose prerequisites are unmet (blocked, with the prerequisite named). */
export declare function buildItemLedger(targets: TargetId[]): Map<string, ItemVerdict>;
/**
 * Record a genuine attempt (a clean tool execution tagged with the ID).
 * pending → executed-clean. `blocked` is NOT auto-flipped: an unmet-prerequisite
 * item cannot have been tested, so recording it as clean would erase the honest
 * reason. Unblocking needs an explicit setDisposition with evidence.
 */
export declare function markAttempted(ledger: Map<string, ItemVerdict>, key: string, auditSeq?: number): boolean;
/**
 * Set a terminal disposition. Enforces the transition rules mechanically:
 * final dispositions (confirmed/killed/na) cannot be overwritten except
 * via the reverify reopen path (which may only move back to pending);
 * "na" requires evidence text.
 */
export declare function setDisposition(ledger: Map<string, ItemVerdict>, key: string, disposition: ItemDisposition, opts?: {
    reason?: string;
    auditSeq?: number;
    viaReverify?: boolean;
}): void;
/** Ensure a dynamic per-CVE runtime instance has a ledger entry (created pending on first sight). Returns its key. */
export declare function ensureCveEntry(ledger: Map<string, ItemVerdict>, cve: string): string;
export interface LedgerSummary {
    total: number;
    pending: number;
    confirmed: number;
    executedClean: number;
    killed: number;
    blocked: number;
    na: number;
}
export declare function ledgerSummary(ledger: Map<string, ItemVerdict>): LedgerSummary;
/** Pending item IDs grouped by target+category — the coordinator reads this to aim re-planning at real gaps. */
export declare function pendingByCell(ledger: Map<string, ItemVerdict>): Array<{
    target: string;
    category: BatteryCategory;
    ids: string[];
}>;
export declare function serializeLedger(ledger: Map<string, ItemVerdict>): ItemVerdict[];
