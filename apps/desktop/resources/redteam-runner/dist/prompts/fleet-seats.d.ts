/**
 * Fleet seat roster: which seats exist, their souls and skill sets, and
 * the prompt input they assemble from (split from fleet-assembly.ts).
 */
import { type VerifiedEngagementRecord } from '@secscan/redteam-fleet-skills';
/** The fleet seats this module assembles prompts for. */
export type FleetSeatRole = 'coordinator' | 'recon' | 'exploiter' | 'reporter' | 'coder' | 'publisher';
/** Soul asset (prompts/souls/<name>.md in the fleet package) per seat. */
export declare const SOUL_BY_ROLE: Readonly<Record<FleetSeatRole, string>>;
/**
 * Layer-2 skill bodies attached per seat: the skills whose tool families
 * the seat's phase actually drives (tools/compose.ts phase sets). Every
 * other skill stays Layer-1 (index only) until it triggers.
 */
export declare const SKILLS_BY_ROLE: Readonly<Record<FleetSeatRole, readonly string[]>>;
/** The knob sources and record a production prompt context carries. */
export interface FleetPromptInput {
    /** The verified engagement record (see {@link verifiedRecordFor}). */
    record: VerifiedEngagementRecord;
    /** Fleet-wide CHARTER knob text (Prompt Pack §4), when a source exists. */
    charterKnobs?: string;
    /** Per-engagement ENGAGEMENT knob text; wins over the charter text. */
    engagementKnobs?: string;
}
