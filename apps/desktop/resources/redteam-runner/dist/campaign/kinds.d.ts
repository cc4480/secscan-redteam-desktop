/**
 * Campaign kind registry (Q-CAMPAIGN, scoping N3).
 *
 * Doctrine-as-data: a CampaignKind carries everything about a campaign
 * doctrine that is NOT the engine — the prompts, the fallback vector
 * roster, the interlock reference, and the launch defaults. Adding a
 * kind is adding a data entry here; the state machine, planner, and
 * executor never branch on a kind name.
 *
 * Field set (scoping D-5): the donor's CampaignKind minus `command`
 * (there is no slash-command surface in this chat-first product; kinds
 * are selected by name at campaign creation), plus `interlockRef` (the
 * Q-LOCKOUT seam the kind names — the campaign layer declares the hook
 * point, Q-LOCKOUT owns the payload) and `defaults` (the launch
 * defaults the executor needs: mode, caps, battery posture).
 *
 * v1 ships ONE kind (Decision C-5): `web-hunt`, the web-application
 * hunt doctrine over the existing engagement modes. The registry admits
 * more kinds without an engine change. The donor's second kind NEVER
 * ports: no kind named "ad" can be registered or validated here — the
 * canonical manifest, Part C, forbids AD modules in this product.
 */
import type { EngagementMode } from '../types.js';
/** One fallback vector: a named attack class with the brief an
 *  engagement launched on it works from, and the surface it owns. */
export interface CampaignVector {
    /** Short slug, unique within the kind (planner focus values are these names). */
    name: string;
    /** Self-contained instruction for the vector. */
    brief: string;
    /** The asset / surface / class this vector is responsible for. */
    owns: string;
}
/** Launch defaults a kind contributes at campaign creation / wave launch. */
export interface CampaignKindDefaults {
    /** Engagement mode the executor launches with unless overridden per launch. */
    mode: EngagementMode;
    /** Default campaign wave cap when creation does not specify one. */
    maxWaves: number;
    /** Default opaque budget ceiling (kind-defined units), when the kind sets one. */
    maxBudget?: number;
    /** Whether waves launch as full-battery engagements by default. */
    fullBattery: boolean;
}
/** One campaign doctrine, as validated data. */
export interface CampaignKind {
    /** Registry name; written into every campaign record of this kind. */
    name: string;
    /** Human-facing label. */
    displayName: string;
    /** Directory prefix for plan artifacts of this kind ("" = none). */
    dirPrefix: string;
    /** Instruction for the engagement's recon posture under this doctrine. */
    reconPrompt: string;
    /** Instruction for the wave planner (the between-waves coordinator call). */
    plannerPrompt: string;
    /** The planner's output contract — the one JSON form planWave accepts. */
    contract: string;
    /** Instruction for campaign-level closing summaries under this doctrine. */
    summaryPrompt: string;
    /** Fallback roster: the deterministic vector matrix a wave falls back
     *  to when planner output is unreadable (donor fallback discipline). */
    vectors: CampaignVector[];
    /** Name of the interlock hook this kind installs at the tool-call seam.
     *  The payload is Q-LOCKOUT's; the campaign layer only declares it. */
    interlockRef: string;
    /** Launch defaults for campaigns of this kind. */
    defaults: CampaignKindDefaults;
}
export declare class CampaignKindError extends Error {
    constructor(message: string);
}
/**
 * Validate an untrusted value as a CampaignKind (file/config boundary
 * discipline: kind definitions are data, and data is validated before
 * the registry trusts it). Returns the kind unchanged on success;
 * throws CampaignKindError naming the offending field otherwise.
 * @param raw - The candidate kind definition.
 * @returns The validated kind.
 */
export declare function validateCampaignKind(raw: unknown): CampaignKind;
/** The one v1 kind (Decision C-5): the web-application hunt doctrine. */
export declare const WEB_HUNT_KIND: CampaignKind;
/**
 * All registered campaign kinds, in registration order.
 * @returns The registered kinds (v1: exactly one).
 */
export declare function listCampaignKinds(): CampaignKind[];
/**
 * Look a kind up by name. Fail-loud: an unknown kind is a configuration
 * error, never a silent default — a campaign created against a kind
 * that does not exist must surface at creation, not at wave 3.
 * @param name - The kind name from a campaign record or CLI input.
 * @returns The registered kind.
 */
export declare function getCampaignKind(name: string): CampaignKind;
/**
 * Whether a kind name resolves in the registry.
 * @param name - The kind name to test.
 * @returns True when the kind is registered.
 */
export declare function hasCampaignKind(name: string): boolean;
