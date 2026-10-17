/**
 * tier.json — the mid-run tier signal (v0.24.0).
 *
 * The autonomy tier is declared at engagement start, but the operator may
 * raise or lower it mid-run (`redteam-runner escalate`, or the UI's
 * Escalate-tier action). There is deliberately no new network surface for
 * this: the escalation writes tier.json into the engagement dir, and the
 * tool dispatcher re-reads it before every tier check, adopting the new
 * tier without restarting the engagement.
 *
 * The approval itself lives in approvals.jsonl (via escalateTier) — tier.json
 * is only the signal the dispatcher watches. Reads are tolerant: a missing
 * or corrupt file means "no change", never a crash.
 */
import type { AutonomyTier } from "./tiers.js";
export declare const TIER_FILE_NAME = "tier.json";
export interface TierFile {
    /** The tier currently in force (what the dispatcher enforces). */
    tier: AutonomyTier;
    /** The tier declared at engagement start (never changes). */
    declared: AutonomyTier;
    environment: "staging" | "production";
    updatedAt: string;
    /** Operator who last changed the tier (absent on the initial write). */
    by?: string;
    /** Recorded reason for the last change (absent on the initial write). */
    reason?: string;
}
/**
 * Tolerant read: undefined when the file is absent or fails validation.
 * The dispatcher treats undefined as "no change" — a half-written or
 * foreign file can never crash or silently alter a running engagement.
 */
export declare function readTierFile(dir: string): TierFile | undefined;
/**
 * Atomic write (tmp file + rename) so a dispatcher re-reading mid-write
 * never observes a partial file. The reader is tolerant anyway — this is
 * defense in depth, not the only guard.
 */
export declare function writeTierFile(dir: string, tf: TierFile): void;
