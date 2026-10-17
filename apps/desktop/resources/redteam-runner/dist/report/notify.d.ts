/**
 * Best-effort Slack lifecycle notifications (v0.19.0 refactor — extracted from report.ts).
 */
import { type Ctx } from "../context.js";
import { SlackEvent } from "../integrations/index.js";
export declare function fireSlack(ctx: Ctx, ev: Omit<SlackEvent, "engagementId" | "target" | "mode">): Promise<void>;
