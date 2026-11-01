/**
 * Operator actions (v0.22.0): reverify, watch triggers, tier escalation.
 *
 * POST /api/engagements/:id/escalate — v0.24.0 mid-run tier change. Same
 * rules as the CLI (`redteam-runner escalate`): raising the tier requires a
 * named operator + reason; lowering is logged freely; Tier 2 on production
 * needs explicit confirmation. The running dispatcher picks the new tier up
 * on its next tool call — no restart.
 * POST /api/reverify — plan or execute a PoC bundle replay (mirrors the
 * CLI's reverify command; execution runs as a background job).
 * GET/POST /api/watch — list watch profiles in a dir; trigger one cycle.
 */
import type { ServerResponse } from "node:http";
import type { UiStore } from "../store.js";
/**
 * POST /api/engagements/:id/escalate { tier, operator, reason?, confirmTier2Production? }
 * v0.24.0: mid-run tier change with the CLI's exact rules. Raising the tier
 * requires a named operator + reason; lowering is logged freely; Tier 2 on
 * production needs explicit confirmation. The running dispatcher picks the
 * new tier up on its next tool call — no restart. Works for CLI-started
 * engagements too (the signal is tier.json on disk, not the UI's live map).
 */
export declare function handleEscalate(store: UiStore, res: ServerResponse, id: string, body: unknown): void;
/** POST /api/reverify — plan (sync) or execute (background job). */
export declare function handleReverify(store: UiStore, res: ServerResponse, body: unknown): Promise<void>;
/** GET /api/jobs/:jobId — background job status. */
export declare function handleJob(store: UiStore, res: ServerResponse, jobId: string): void;
/** GET /api/watch/profiles — list parseable watch profiles in the fixed dir. */
export declare function handleWatchProfiles(res: ServerResponse, _query: URLSearchParams): void;
/** POST /api/watch/trigger { profile, trigger? } — one cycle, background job. */
export declare function handleWatchTrigger(store: UiStore, res: ServerResponse, body: unknown): void;
