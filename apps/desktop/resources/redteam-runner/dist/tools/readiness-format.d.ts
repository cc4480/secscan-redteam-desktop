/**
 * Readiness formatters — extracted from readiness.ts to keep the readiness
 * module under the 300-line budget.
 */
import type { PoolSnapshot } from "@secscan/redteam-llm-router";
import type { ReadinessItem, ReadinessReport } from "./readiness-items.js";
/** "~12m" / "~3h" for a bench's remaining time. */
export declare function formatBenchRemaining(remainingMs: number): string;
/**
 * The `llm_credential_pool` readiness item (pool-persistence spec §1.6):
 * rendered ONLY when some pool entry is dead or benched — a healthy or
 * empty pool omits the item entirely rather than taking a green line.
 * The detail names each affected key by fingerprint (never key material):
 * dead keys with their recorded reason plus, when the pool recorded them,
 * the killing response's HTTP status/code and the death time; benched (key, model) pairs with
 * the time until they are eligible again, or "no automatic return" for
 * permanent (entitlement) benches. Benches that have already lapsed by
 * render time are skipped. Pure over the snapshots so tests feed it
 * fixtures; the report builder passes the router's live poolSnapshots().
 */
export declare function credentialPoolItem(snapshots: PoolSnapshot[], nowMs: number): ReadinessItem | undefined;
/** Render a report as a plain-text table for the CLI. */
export declare function formatReadiness(report: ReadinessReport): string;
