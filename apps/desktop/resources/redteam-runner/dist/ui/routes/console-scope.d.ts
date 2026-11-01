/**
 * Operator console API — Scope & Safety view (Phase 5, view 4).
 *
 * GET /api/console/scope — read-only. Aggregates the refusal and halt
 * records the dispatcher already writes to each engagement's events.jsonl,
 * across the 25 most recent engagement dirs under the console engagements
 * dir (including a live/ level when the dir is the parent). Nothing here
 * is inferred: every count traces to an event action the code appends.
 *
 * Grounded event actions (append sites verified in source):
 *   scope_violation           dispatch/scope-gate.ts — deny-beats-allow
 *                             scope refusal (host or command-text target)
 *   policy_denied             dispatch/policy-gate.ts — operator policy
 *   hook_evaluated (deny)     dispatch/policy-gate.ts — PreToolUse hook
 *                             evaluations; a denial is the evaluation
 *                             whose result reads "<phase>:<name> deny …"
 *   scope_authorization_denied phases/authorize.ts — engagement refused
 *                             before it started (target = the domain)
 *   target_auto_halt          dispatch/router.ts — per-target distress
 *                             halt (target = halted host)
 *   abort_engagement          dispatch/router.ts — operator kill switch
 *                             / coordinator abort record
 *   engagement_halted         phases/run.ts — the run unwound to halted;
 *                             the reason text is classified below
 *
 * NOT recorded in events.jsonl, therefore never counted here (see notes):
 * autonomy-tier denials, variant-cap denials, and halted-host refusals —
 * dispatch returns those denial strings without appending an event.
 * Events also carry no tool name, so records omit it rather than guess.
 *
 * Response:
 * {
 *   generatedAt: string,
 *   available: true,
 *   window: { engagementsScanned: number },
 *   totals: { denials, scopeViolations, policyDenials, hookDenials,
 *             authorizationDenied, targetAutoHalts, engagementHalts,
 *             aborts, halts },
 *   haltReasons: [{ reason, count }],           // engagement_halted only
 *   perEngagement: [{ id, target, startedAt, denials, halts, total }],
 *   latest: [{ ts, engagementId, kind, target, reason }],   // newest 50
 *   notes: string[],
 * }
 * An engagements root with no engagement dirs yet answers the same
 * aggregate with every count zero and engagementsScanned 0 — an empty
 * history is a valid state, not an error.
 * `denials` counts refused calls: each was refused inside dispatch,
 * before any handler ran — zero packets left the machine for them.
 * `halts` = targetAutoHalts + engagementHalts (aborts are counted
 * separately; an abort normally also produces an engagement_halted).
 */
import type { ServerResponse } from 'node:http';
import type { UiStore } from '../store.js';
export declare function handleConsoleScope(store: UiStore, res: ServerResponse): void;
