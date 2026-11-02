/**
 * Coordinator task model: TaskDef/TaskResult, runTask, runBatch, validateTasks (v0.19.0 refactor — extracted from phases.ts).
 */
import { type BatteryCategory } from "../battery.js";
import { type Ctx } from "../context.js";
export interface TaskDef {
    id: string;
    kind: "probe" | "recon";
    brief: string;
    attackId?: string;
    category?: BatteryCategory;
    /** Battery item ID this task covers (v0.18.0) — surfaced to the specialist via taskPrompt. */
    batteryItem?: string;
    /**
     * Declared custom-code need (fleet audit M1): a payload, exploit script,
     * or encoder this task must GENERATE rather than fetch. When present on a
     * probe task, runTask requests the artifact from the coder (TANK) seat
     * (exploit-cell/coder.ts) before the exploiter loop starts and hands the
     * returned artifact to the exploiter in its task prompt. Probe tasks only,
     * for the same reason batteryItem is: recon never crafts payloads.
     */
    codeNeed?: string;
    maxTurns: number;
}
export interface TaskResult {
    task: TaskDef;
    summary: string;
    /** The coder (TANK) artifact this task consumed, when it declared a codeNeed. */
    coderArtifact?: string;
    probesBefore: number;
    probesAfter: number;
    findingsBefore: number;
    findingsAfter: number;
    killedBefore: number;
    killedAfter: number;
}
/**
 * "Spawn a subagent": execute one discrete task as a bounded foundation loop
 * with a task-scoped specialist prompt. Fresh context, cyber task definition.
 */
export declare function runTask(ctx: Ctx, task: TaskDef): Promise<TaskResult>;
/**
 * Fan-out with a concurrency cap: red fans out independent tasks in parallel,
 * black runs strictly one at a time (stealth). HaltError always propagates.
 */
export declare function runBatch(ctx: Ctx, tasks: TaskDef[], cap: number): Promise<TaskResult[]>;
/**
 * Cyber-layer task validation: the coordinator proposes, the runner disposes.
 * Unknown/excluded ATT&CK IDs and invalid categories are rejected (with an
 * event) — the coordinator re-plans without them.
 */
export declare function validateTasks(ctx: Ctx, raw: Array<Record<string, unknown>>, cap: number): TaskDef[];
export interface CoordinatorDirective {
    tasks: TaskDef[];
    finish: boolean;
    note: string;
}
/**
 * One coordinator command turn: DECOMPOSE (initial) or RE-PLAN (after every
 * observation round). Returns validated tasks or a finish decision.
 */
