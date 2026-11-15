/**
 * Target-family protocols (the "no headless chicken" layer).
 *
 * Every engagement binds to exactly ONE target family before any seat acts.
 * The family decides, mechanically:
 *
 *   - what the recon seat enumerates first (platform, not pages),
 *   - which skills ride in each seat's prompt (a Windows host gets AD/SMB/
 *     WinRM tooling, never webapp-scan; an Android app gets mobile static and
 *     dynamic analysis, never nmap-first),
 *   - which ordered steps exist, who owns each, what each step must collect,
 *     and what evidence closes it,
 *   - what the seat may NOT do on that family.
 *
 * A seat acts inside the CURRENT step only. A tool outside the step's allowlist
 * needs a recorded rationale naming the step it serves; an unmapped family runs
 * the DETECTION step before anything else. A step with no applicable surface is
 * closed with a recorded verdict carrying the observation that proves it — never
 * silently skipped and never marked clean.
 */
import type { FleetSeatRole } from './fleet-seats.js';
/** The target families an engagement can bind to. */
export type TargetFamily = 'webapp' | 'windows' | 'linux' | 'android' | 'ios' | 'network';
/** One ordered step of a family's protocol. */
export interface ProtocolStep {
    /** Stable step id cited in action rationale and evidence (`WIN-03`). */
    id: string;
    /** What this step establishes. */
    title: string;
    /** The seat that owns the step. One step, one owner. */
    owner: FleetSeatRole;
    /** Tools the owner may use for this step. Anything else needs a rationale. */
    tools: readonly string[];
    /** What must be collected while the step runs. */
    collect: readonly string[];
    /** The observable condition that closes the step. */
    done: string;
    /** The artifact that proves the step ran. */
    evidence: string;
}
/** A family's complete protocol: intelligence, ordered steps, guardrails. */
export interface TargetProtocol {
    family: TargetFamily;
    label: string;
    /** Evidence gathered BEFORE any active action, to place the family. */
    intelligence: readonly string[];
    /** How the family is confirmed on this target. */
    confirm: string;
    /** Ordered steps. Order is the plan; skipping forward needs a reason on record. */
    steps: readonly ProtocolStep[];
    /** Actions that are wrong for this family regardless of ROE. */
    forbidden: readonly string[];
    /**
     * The task each seat owns in this family. No seat is left undefined: a seat
     * that owns no step still has a standing duty here, and it is written down.
     */
    seatTasks: Readonly<Record<FleetSeatRole, string>>;
    /** Layer-2 skills bound per seat for this family. */
    skills: Readonly<Record<FleetSeatRole, readonly string[]>>;
}
/** Law every seat carries, whatever the family. */
export declare const PROTOCOL_LAW: string;
/** Every protocol, by family — the family's own steps, then the shared three. */
export declare const TARGET_PROTOCOLS: Readonly<Record<TargetFamily, TargetProtocol>>;
/** The result of binding a target to a family. */
export interface FamilyBinding {
    family: TargetFamily;
    /** Why this family was chosen. */
    reason: string;
    /** declared = operator named it; inferred = derived from the target; default = discovery-first. */
    confidence: 'declared' | 'inferred' | 'default';
}
/**
 * Bind a target to exactly one family BEFORE any seat acts.
 *
 * Order: the operator's declared family wins (it is the engagement's own
 * statement); otherwise the target's shape infers it; otherwise the engagement
 * binds `network` and the protocol's first act is classification. An
 * unrecognized declared value never silently becomes another family.
 *
 * @param input - the engagement target and any declared target families.
 * @returns the binding, with the reason recorded for the board.
 */
export declare function bindTargetFamily(input: {
    target: string;
    declared?: readonly string[];
}): FamilyBinding;
/**
 * The skills one seat binds for a family.
 * @param role - the fleet seat.
 * @param family - the bound family.
 * @returns the skill names to bind (Layer-2 bodies).
 */
export declare function skillsForRole(role: FleetSeatRole, family: TargetFamily): readonly string[];
/**
 * Render the protocol as the prompt block every seat carries.
 * @param binding - the family binding to render.
 * @returns markdown block: law, family, ordered steps with owner/tools/exit.
 */
export declare function protocolPromptBlock(binding: FamilyBinding): string;
