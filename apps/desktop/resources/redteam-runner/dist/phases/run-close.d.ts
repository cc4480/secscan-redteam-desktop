import { type Ctx } from '../context.js';
import { type EventLog } from '../events.js';
import { type EngagementResult } from '../types.js';
export interface CloseIncompleteArgs {
    ctx: Ctx;
    events: EventLog;
    /** The engagement directory (report.md lands here). */
    dir: string;
    engagementId: string;
    brief: string;
    summary: string;
}
export declare function closePhaseIncomplete(args: CloseIncompleteArgs, reason: string, kind: 'blocked' | 'halted'): Promise<EngagementResult>;
