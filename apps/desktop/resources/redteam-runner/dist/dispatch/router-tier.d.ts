/**
 * Mid-run tier refresh: re-read tier.json so an operator escalation
 * takes effect without restarting the engagement (split from router.ts).
 */
import { type Ctx } from '../context.js';
import { type EngagementPhase } from '../types.js';
/**
 * v0.24.0: mid-run tier changes. The operator may raise/lower the tier via
 * `redteam-runner escalate` or the UI; both rewrite tier.json in the
 * engagement dir (atomically). The dispatcher re-reads it before every tier
 * check so the new tier takes effect without restarting the engagement.
 * The change lands in the audit log — never silent. A missing or corrupt
 * file means "no change". Exported for tests; dispatchTool calls it.
 */
export declare function refreshTierFromDisk(ctx: Ctx, phase: EngagementPhase): void;
