/**
 * Q-RP-11 — the host-inventory report sections (parity audit rows
 * 18–20): Host & Security Posture Inventory (§6), Filesystem Inventory
 * (§7), Sensitive Data & Credential Exposure (§8). Markup only — every
 * figure arrives from report/host-inventory.ts; counts printed here are
 * derived from the row arrays there, and a recorded-vs-derived
 * disagreement renders as a note, never a silent substitution.
 *
 * Absence rules mirror the detail sections: no artifact => these
 * functions are never called with data and the report is unchanged;
 * a failed artifact renders the failure panel; an optional block the
 * collector did not carry renders nothing, not an empty table. An
 * EMPTY required block (volumes/accounts/patches/software) renders
 * "Not collected" — the permanent fallback whenever collection is
 * declined or unavailable — never a claim that none exist.
 */
import { type HostInventoryArtifact } from "../host-inventory.js";
/** Human byte size for inventory tables (1024-based, one decimal). */
export declare function fmtBytes(n: number): string;
/**
 * The inventory block for one engagement. `undefined` (no artifact)
 * renders nothing at all; a failed artifact renders the honest panel;
 * an ok artifact renders §§6–8 with the derived-count line and any
 * reconciliation notes.
 */
export declare function inventorySection(artifact: HostInventoryArtifact | undefined): string;
