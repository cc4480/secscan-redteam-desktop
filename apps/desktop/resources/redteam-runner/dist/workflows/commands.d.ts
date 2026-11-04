/**
 * Operator command protocol.
 *
 * Slash commands are the operator's interface to an autonomous run: each one
 * names the objective, the target profile, the phases the agents must complete,
 * the tools they may use, the approval gate, and the artifacts the run must
 * produce. The agent loop owns *how*; the command owns *what* and *when to
 * stop*, so a run cannot quietly narrow itself.
 *
 * Commands are parsed here, planned into an ordered phase list, and handed to
 * the existing engagement engine. Nothing in this module talks to a target.
 */
import type { TargetId } from "../targets.js";
import type { EngagementInput, EngagementPhase } from "../types.js";
/** One slash command the operator may type. */
export interface CommandSpec {
    /** Canonical name including the slash, e.g. `/deepscan`. */
    readonly name: string;
    /** One-line description shown to the operator and the model. */
    readonly summary: string;
    /** Usage line. */
    readonly usage: string;
    /** Phases the run must complete, in order. */
    readonly phases: readonly EngagementPhase[];
    /** Target families the command defaults to when none is named. */
    readonly targets: readonly TargetId[];
    /** Tools the agents may call during this command. */
    readonly tools: readonly string[];
    /** Autonomy tier: 0 read-only, 1 active testing, 2 destructive approved. */
    readonly tier: 0 | 1 | 2;
    /** True when the run must stop for operator approval before the exploit phase. */
    readonly requiresApproval: boolean;
    /** True for a LOCAL-host engagement (Q-RP-11): the target is the
     * machine the app runs on, collected on-host — never a remote
     * battery re-aimed at the machine's own hostname. */
    readonly local?: boolean;
    /** Artifacts the run must leave behind. */
    readonly artifacts: readonly string[];
}
/** Parsed invocation of a command, with args and resolved targets. */
export interface CommandInvocation {
    readonly command: CommandSpec;
    readonly raw: string;
    readonly args: readonly string[];
    readonly targets: readonly TargetId[];
}
/** Every command the operator can use. */
export declare const COMMANDS: readonly CommandSpec[];
/** Lookup by name, case-insensitively; `/x` and `x` both resolve. */
export declare function findCommand(name: string): CommandSpec | undefined;
/**
 * The engagement semantics of one sibling command (S2-H2): the tier,
 * phase list, default target families, and approval requirement a launch
 * must carry so the sibling does not collapse into a plain /scan. This
 * is the one projection of the registry every launch surface reads —
 * the CLI's input builder and the chat launch path (ui/types.ts
 * UiLaunchRequest.command → buildLaunchBody → toEngagementInput).
 */
export interface SiblingSpec {
    /** Canonical name WITHOUT the slash, e.g. `nmap`. */
    readonly name: string;
    /** Autonomy tier the command runs at. */
    readonly tier: 0 | 1 | 2;
    /** Phases the run must complete, in order. */
    readonly phases: readonly EngagementPhase[];
    /** Target families the command defaults to. */
    readonly targets: readonly TargetId[];
    /** True when the run must stop for operator approval before the exploit phase. */
    readonly requiresApproval: boolean;
}
/**
 * Every registry command except /scan (the plain launch, which carries
 * no command stamp) and /report (report delivery, not a launch),
 * projected to {@link SiblingSpec}. Derived from COMMANDS so the specs
 * can never drift from the registry.
 */
export declare const SIBLING_COMMANDS: readonly SiblingSpec[];
/**
 * Resolve one sibling by name (`/x` and `x` both resolve, via
 * {@link findCommand}).
 * @param name - the command name as given by the caller.
 * @returns the sibling spec, or undefined for /scan, /report, and unknown names.
 */
export declare function findSiblingCommand(name: string): SiblingSpec | undefined;
/**
 * Parse one operator line into an invocation.
 * @param line - e.g. `/deepscan app.example.com webapp,windows`
 * @param defaultTargets - resolved targets when the line names none.
 * @returns the invocation, or an error string for an unknown command.
 */
export declare function parseCommand(line: string, defaultTargets?: readonly TargetId[]): CommandInvocation | string;
/** One planned phase of a command run. */
export interface PlannedPhase {
    readonly phase: EngagementPhase;
    /** What the agents must achieve in this phase, in one line. */
    readonly objective: string;
    /** Tools allowed in this phase, intersected with the command's allowlist. */
    readonly tools: readonly string[];
}
/**
 * Expand a command into the ordered phase plan the agent loop follows.
 * @param invocation - parsed command.
 * @returns the plan with one entry per phase.
 */
export declare function planCommand(invocation: CommandInvocation): readonly PlannedPhase[];
/**
 * Build the EngagementInput for a LOCAL command invocation (/pcscan):
 * the target is this machine's hostname, the scope is exactly that
 * hostname, and localHost is set so the collector runs on-host. The
 * old shell instead re-aimed the remote battery at the hostname and
 * stamped the run production + confirmProduction — both gone: a local
 * assessment is a staging-class run against the operator's own box,
 * attested by the operator running it.
 * @param invocation - parsed local command.
 * @param host - this machine's hostname.
 * @param mode - engagement mode from the CLI (red|black).
 * @returns the engagement input for runEngagement.
 */
export declare function buildLocalEngagementInput(invocation: CommandInvocation, host: string, mode?: EngagementInput["mode"]): EngagementInput;
/** The operator-facing help text, generated from the registry. */
export declare function commandHelp(): string;
