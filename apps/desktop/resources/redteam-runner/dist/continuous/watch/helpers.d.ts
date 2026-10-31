/**
 * Watch-cycle helpers: ids, the real reverify fn, best-effort Slack,
 * drift-ticket backfill, and run-dir/history appends. The cycle itself
 * lives in cycle.ts; the loop in loop.ts.
 */
import type { WatchProfile } from "../profile.js";
import { notifySlack } from "../../integrations/index.js";
import type { HttpFn } from "../../integrations/index.js";
import type { EngagementInput } from "../../types.js";
import type { DriftReport, ReverifyFn } from "../drift.js";
import { type LogRotationConfig } from "../../safety/rotation.js";
export declare function slug(s: string): string;
export declare function cycleEngagementId(profile: WatchProfile, trigger: string | undefined, now: Date): string;
/** Real reverify: bundle → reverifyBundle with the production replayer. */
export declare function realReverifyFn(scope: string[], env: NodeJS.ProcessEnv): ReverifyFn;
/** Best-effort Slack send. Never throws. */
export declare function bestEffortSlack(env: NodeJS.ProcessEnv, http: HttpFn, ev: Parameters<typeof notifySlack>[1]): Promise<void>;
/**
 * Ensure every NEW finding has a ticket. The engagement's own reportPhase
 * already synced all confirmed findings (including new ones) via the
 * existing integrations — this only fills gaps (e.g. sinks were
 * unconfigured during reportPhase). Never duplicates: findings already
 * present in integrations.json are skipped, and the mapping is merged,
 * not overwritten.
 */
export declare function ensureDriftTickets(runDir: string, drift: DriftReport, input: EngagementInput, env: NodeJS.ProcessEnv, http: HttpFn): Promise<void>;
export declare function appendSection(filePath: string, body: string): void;
/**
 * v0.26.0: history.jsonl is the watch home's append-only audit trail (one
 * line per cycle). It rotates under the profile's log-retention config so
 * an indefinite watch loop can't exhaust the runner host's disk.
 */
export declare function appendHistory(home: string, line: Record<string, unknown>, rotation?: LogRotationConfig): void;
/**
 * Run one watch cycle: freshness gate → engagement → drift → baseline →
 * alerts. Never throws for operational failures — they become a result
 * with status refused/error and a reason.
 */
