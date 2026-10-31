/**
 * Harness2 cherry-pick: shared contract.
 *
 * Every part of the harness-optimization subsystem codes against this module.
 * The decomposition mirrors Harness2's eight editable harness components, but
 * the red-team guardrail component is pinned and can never appear in a proposal.
 */
/** The eight harness components from Harness2, with dsh's implementation names. */
export declare const HARNESS_COMPONENTS: {
    readonly systemPrompt: "system-prompt";
    readonly guardrails: "guardrails";
    readonly memory: "memory";
    readonly toolGuidance: "tool-guidance";
    readonly subagents: "subagents";
    readonly skills: "skills";
    readonly scripts: "scripts";
    readonly plugins: "plugins";
};
/** Component id union. */
export type HarnessComponentId = (typeof HARNESS_COMPONENTS)[keyof typeof HARNESS_COMPONENTS];
/** Components a proposal may target. Guardrails are permanently excluded. */
export declare const EDITABLE_COMPONENTS: readonly HarnessComponentId[];
/** Component that is pinned: any proposal touching it is auto-rejected and flagged. */
export declare const PINNED_COMPONENT: HarnessComponentId;
/** Health of one engagement run, normalized for scoring. */
export type RunOutcome = 'success' | 'partial' | 'failure' | 'aborted';
/** Target class used to bucket runs and lessons, e.g. "wordpress", "nginx", "windows-ad". */
export type TargetClass = string;
/** The harness version stamp that produced a run. */
export interface HarnessStamp {
    /** Runner version from package.json. */
    readonly runnerVersion: string;
    /** Git commit of the repository, when available. */
    readonly commit?: string;
    /** Ordered ids of the active dsh patch layers (the composed harness). */
    readonly layerIds: readonly string[];
    /** sha256 hex per component file set, so two runs are comparable. */
    readonly componentHashes: Readonly<Partial<Record<HarnessComponentId, string>>>;
}
/** Outcome metrics: the ground truth the paper did not have. */
export interface RunMetrics {
    readonly runId: string;
    readonly engagementId: string;
    readonly targetClass: TargetClass;
    readonly outcome: RunOutcome;
    /** Confirmed findings. */
    readonly vulnsFound: number;
    /** Findings recorded then killed as non-issues. */
    readonly falsePositives: number;
    /** Attacks that provably succeeded. */
    readonly exploitsSucceeded: number;
    /** Attacks attempted. */
    readonly exploitsAttempted: number;
    /** Planner steps consumed. */
    readonly steps: number;
    /** Prompt tokens billed to the local model. */
    readonly tokensIn: number;
    /** Completion tokens billed to the local model. */
    readonly tokensOut: number;
    readonly durationMs: number;
    /** The composed harness that produced this run. */
    readonly harness: HarnessStamp;
    readonly startedAt: string;
    readonly finishedAt: string;
}
/** One normalized trajectory event (a superset of EngagementEvent, no secrets). */
export interface TrajectoryEvent {
    readonly ts: string;
    readonly phase: string;
    readonly actor: string;
    readonly action: string;
    readonly attackId?: string;
    readonly target?: string;
    readonly result: string;
    /** True when the event is a tool invocation, so the tuner can see tool use. */
    readonly isToolCall: boolean;
}
/** A complete run: metrics plus the ordered trajectory. */
export interface TrajectoryRecord {
    readonly metrics: RunMetrics;
    readonly events: readonly TrajectoryEvent[];
}
/** One contrasted pair: a high-yield run versus a low-yield run on the same class. */
export interface ContrastPair {
    readonly positive: TrajectoryRecord;
    readonly negative: TrajectoryRecord;
}
/** A dated lesson appended to a target class's EXPERIENCE.md. */
export interface ExperienceEntry {
    /** ISO date, e.g. 2026-10-18. */
    readonly date: string;
    readonly targetClass: TargetClass;
    /** Layer id this lesson belongs to, when it came from an adopted edit. */
    readonly layerId?: string;
    /** What changed in the harness. */
    readonly change: string;
    /** Why it was proposed. */
    readonly reason: string;
    /** Measured effect on the outcome metrics (never an estimate). */
    readonly measuredEffect: string;
    /** Tokens spent producing and probing the change. */
    readonly tokensSpent: number;
}
/** Layers that may be mounted on top of the base profile. */
export interface PatchLayer {
    readonly id: string;
    /** Target class the layer applies to; `undefined` means a general layer. */
    readonly targetClass?: TargetClass;
    /** The YAML body of the layer (a cordis patch document). */
    readonly yaml: string;
    /** ISO date the layer was adopted. */
    readonly adoptedAt: string;
    /** The probe run that justified adoption. */
    readonly evidenceRunId: string;
}
/** A proposed, not yet adopted, layer edit. */
export interface Proposal {
    readonly id: string;
    readonly targetClass: TargetClass;
    /** Component the proposal edits. */
    readonly component: HarnessComponentId;
    /** The proposed layer YAML. */
    readonly yaml: string;
    /** Editor rationale, verbatim from the pasted-back package. */
    readonly rationale: string;
}
/** Result of probing one proposal against the base layer set. */
export interface ProbeVerdict {
    readonly proposalId: string;
    readonly adopted: boolean;
    /** Metric deltas (candidate minus base); positive is better. */
    readonly deltas: Readonly<Record<'vulnsFound' | 'falsePositives' | 'steps' | 'tokensIn' | 'tokensOut', number>>;
    /** Runs compared, so a single lucky run cannot adopt a layer. */
    readonly baseRuns: number;
    readonly candidateRuns: number;
    /** Why adopted or discarded. */
    readonly reason: string;
    readonly tokensSpent: number;
}
/** The paste-ready package Carlos gives the frontier editor model. */
export interface ProposalPackage {
    readonly targetClass: TargetClass;
    /** The current (base) layer set. */
    readonly baseLayerSet: readonly string[];
    /** The current editable component files, verbatim. */
    readonly componentFiles: readonly {
        component: HarnessComponentId;
        path: string;
        body: string;
    }[];
    /** Contrasted trajectories with their metrics. */
    readonly pairs: readonly ContrastPair[];
    /** The class's accumulated lessons. */
    readonly experience: readonly ExperienceEntry[];
    /** Aggregate outcome metrics for the contrast. */
    readonly metrics: Readonly<Record<string, number>>;
    /** Markdown instructions for the editor: constraints, format, pinned guardrails. */
    readonly instructions: string;
}
/** Filesystem layout for the subsystem (large artifacts live off C:). */
export interface Harness2Paths {
    /** Root, e.g. E:\secscan-harness2. */
    readonly root: string;
    /** SQLite database file. */
    readonly database: string;
    /** Adopted patch layers. */
    readonly layers: string;
    /** Per-target-class EXPERIENCE.md files. */
    readonly experience: string;
    /** Proposal packages / probe runs. */
    readonly runs: string;
}
/** Where the subsystem keeps its state; overridable for tests. */
export declare function resolveHarness2Paths(environment?: NodeJS.ProcessEnv): Harness2Paths;
