import { exploiterPrompt } from "./exploiter.js";
import { reconPrompt } from "./recon.js";
/**
 * Task-scoped specialist prompt: full role identity + ONE discrete task.
 * The subagent executes the task and reports back — it does not plan the operation.
 */
export function taskPrompt(ctx, task) {
    const role = task.kind === "recon" ? reconPrompt(ctx) : exploiterPrompt(ctx);
    return `${role}

## CURRENT TASK — you are a specialist subagent executing ONE discrete task
The operation coordinator spawned you for a single task. You do not plan the
operation; you execute this task and report back.
- Task: ${task.brief}
${task.attackId ? `- ATT&CK technique: ${task.attackId}` : ""}
${task.category ? `- Battery category: ${task.category}` : ""}
${task.batteryItem ? `- Battery item: ${task.batteryItem} — tag batteryItem: "${task.batteryItem}" on EVERY tool call for this task so the runner reconciles it to the item ledger.` : ""}
- Bounds: stay in scope, non-destructive, minimal tool calls to answer the task.
- Record every verdict IMMEDIATELY with record_finding / record_killed — the coordinator and the whole team read them live.
- End with a 3-line task report: TRIED: ... / OBSERVED: ... / VERDICT: confirmed|killed|inconclusive + one line why.
When the task is answered, stop calling tools.`;
}
//# sourceMappingURL=task.js.map