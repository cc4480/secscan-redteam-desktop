/**
 * Phase-anchor elicitation — split out of charter-completion.ts for the
 * file budget, with no behaviour change. The four marker questions are
 * answered once per phase and cached per Ctx; a failed elicitation is
 * recorded as a missing anchor and never blocks the phase.
 */
import { type CharterEngagement, type CharterRole } from '@secscan/redteam-llm-router';
import { type CharteredCallSeams } from './charter-completion.js';
import { type Ctx } from './context.js';
import { type EngagementPhase } from './types.js';
export declare function anchorFor(ctx: Ctx, phase: EngagementPhase, role: CharterRole, engagement: CharterEngagement, seams: CharteredCallSeams): Promise<string | undefined>;
