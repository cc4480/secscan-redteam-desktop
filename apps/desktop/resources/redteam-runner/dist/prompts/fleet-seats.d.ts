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
 * Layer-2 skill bodies attached per seat, keyed by TARGET FAMILY in
 * `target-protocol.ts` — a Windows engagement binds AD/SMB/WinRM skills, an
 * Android engagement binds mobile analysis, a webapp binds web tooling. This
 * map is the DEFAULT (webapp/flat) set: it also seeds the asset loader, which
 * must read every family's bodies (see fleet-assembly.ts).
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
