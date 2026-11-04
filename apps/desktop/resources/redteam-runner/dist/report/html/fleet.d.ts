/**
 * The standing fleet roster the report's team section renders — extracted
 * from wire.ts to keep the wiring module under the 300-line budget.
 */
import { type TeamMember } from './sections.js';
/** The fleet roster as the report's team section states it: every
 * seat, its role on the engagement. Summaries stay with the record —
 * the wire carries the standing roles only. */
export declare const FLEET_TEAM: TeamMember[];
