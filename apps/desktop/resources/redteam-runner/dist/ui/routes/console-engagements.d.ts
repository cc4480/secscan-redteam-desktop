/**
 * Operator console API — Engagements view (Phase 5, view 1).
 *
 * GET /api/console/engagements answers:
 *   {
 *     available: boolean,          // false when the engagements dir is absent
 *     reason?: string,             // present only when available is false
 *     generatedAt: string,         // ISO timestamp of this response
 *     engagements: ConsoleEngagement[]   // at most 20, live first, then newest
 *   }
 *
 * ConsoleEngagement (fields are null when the artifact that carries them is
 * missing — the console shows what the artifacts say, never an estimate):
 *   {
 *     id: string,
 *     live: boolean,               // reconciled by UiStore for live-dir runs
 *     source: "live" | "archive",  // which engagements root the run came from
 *     status: string, phase: string,
 *     target: string, mode: string,
 *     startedAt: string, updatedAt: string,
 *     actions: number,             // state.eventCount (events recorded)
 *     steps: number | null,        // metrics.json steps (post-capture only)
 *     tokens: { in: number, out: number, total: number } | null,
 *     durationMs: number | null,
 *     findings: { total: number, proven: number, provenShare: number | null },
 *     verdicts: { total: number, byDisposition: Record<string, number> } | null,
 *     layers: { ids: string[], components: Record<string, string> } | null,
 *     hasReport: boolean,
 *     error?: string               // launch/orphan failure note, when recorded
 *   }
 *
 * Sources, per engagement dir (engagements/live/<id>/ or the sibling
 * engagements/archive/<id>/): state.json is the canonical run record (the
 * same LiveState the engagements routes read); metrics.json is the harness2
 * RunMetrics written at trajectory capture (steps, tokens, harness stamp);
 * a finding counts as PROVEN when its PoC bundle poc/<finding-id>.json
 * exists — the same definition the findings route exposes as hasProof.
 * item-verdicts.json carries the per-item dispositions counted here.
 *
 * Read-only: this route reads artifacts and the store's in-memory list; it
 * writes nothing.
 */
import type { ServerResponse } from 'node:http'
import type { UiStore } from '../store.js'
/**
 * GET /api/console/engagements — the 20 most recent engagements, live first.
 *
 * @param store - the UI store (engagement list + engagements dir)
 * @param res - the HTTP response to write the JSON payload to
 * @returns nothing; the response is written to `res`
 */
export declare function handleConsoleEngagements(store: UiStore, res: ServerResponse): void
