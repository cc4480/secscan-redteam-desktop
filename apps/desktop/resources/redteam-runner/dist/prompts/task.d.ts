import type { PromptContext } from "./shared.js";
/** A discrete unit of work the coordinator delegates to one specialist subagent (structural — no import from phases.js). */
export interface TaskBrief {
    kind: "probe" | "recon";
    brief: string;
    attackId?: string;
    category?: string;
    /** Battery item ID this task covers (v0.18.0) — the specialist tags it on every tool call. */
    batteryItem?: string;
}
/**
 * Task-scoped specialist prompt: full role identity + ONE discrete task.
 * The subagent executes the task and reports back — it does not plan the operation.
 */
export declare function taskPrompt(ctx: PromptContext, task: TaskBrief): string;
