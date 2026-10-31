/**
 * Coordinator directive synthesis (v0.19.0 refactor — extracted from phases.ts).
 */
import { COMMAND_TOOLS } from "../tools.js";
import { HaltError, type Ctx } from "../context.js";
import { describeErrorCause } from "@secscan/redteam-llm-router";
import { agentLoop, promptCtx } from "../agents.js";
import { coordinatorPrompt } from "../prompts.js";
import { extractJsonBlock } from "../util.js";
import { validateTasks } from "./tasks.js";
import { type CoordinatorDirective } from "./tasks.js";

export async function coordinatorDirective(
  ctx: Ctx,
  kind: "decompose" | "replan",
  context: string,
): Promise<CoordinatorDirective> {
  const cap = ctx.input.mode === "black" ? 1 : 3;
  const head =
    kind === "decompose"
      ? `DECOMPOSE — break the operation into small discrete tasks (one task, one specialist, one objective). ` +
        `Fan out independent hypotheses${ctx.input.mode === "black" ? " ONE AT A TIME (black mode: stealth, strictly sequential)" : " in parallel (red mode: up to 3 per round)"}. ` +
        `Put promising leads in their own dedicated tasks. Include registry-informed tasks (fuse what worked before). ` +
        `Tasks must span all three battery categories (logic | functionality | validation) before finish.`
      : `RE-PLAN — the last batch completed. Re-evaluate from the fresh observations: PIVOT to new angles, ESCALATE a promising lead with a dedicated deeper task, ` +
        `GO STEALTHY on detection signals, BACK OFF cooled-down vectors, SPAWN MORE HELP across independent surface. Never coast on the earlier plan.`;
  const text = await agentLoop(
    ctx,
    "coordinator",
    "exploit",
    coordinatorPrompt(promptCtx(ctx)),
    `${head}\n\nReturn ONLY a JSON block: {"tasks": [<at most ${cap} task(s) this round>, {"kind": "probe|recon", "brief": "<1-2 sentences>", "attackId": "<ATT&CK, optional>", "category": "<logic|functionality|validation — PROBE TASKS ONLY, omit on recon>", "batteryItem": "<battery item ID this task covers, e.g. SS-042 — PROBE TASKS ONLY, pick a real ID from the pending list, or OMIT>", "maxTurns": 6}], "finish": <true only when the objective is met AND (battery complete — every battery item verdict-recorded, none pending — OR probe budget exhausted OR no applicable surface declared with reasons)>, "note": "<what changed and why, one line>"}\n\n${context}`,
    COMMAND_TOOLS,
    3,
  );
  const parsed = extractJsonBlock(text) as {
    tasks?: Array<Record<string, unknown>>;
    finish?: boolean;
    note?: string;
  } | null;
  const tasks = validateTasks(ctx, Array.isArray(parsed?.tasks) ? parsed!.tasks! : [], cap);
  const finish = parsed?.finish === true;
  const note = typeof parsed?.note === "string" ? parsed.note.slice(0, 300) : text.slice(0, 300);
  ctx.events.append({
    phase: "exploit",
    actor: "coordinator",
    action: kind === "decompose" ? "decompose" : "replan",
    result: `${note} → ${tasks.length} task(s)${finish ? ", FINISH requested" : ""}`,
  });
  return { tasks, finish, note };
}

/**
 * coordinatorDirective with the honest-close failure path (Q-HALT Item 4).
 *
 * A directive call that fails (e.g. the provider safety-rejects the re-plan
 * context) must not halt the engagement: the phase has completed work worth
 * reporting, and every other incompleteness in the phase closes honestly.
 * On success this returns the directive; on a HaltError it RETHROWS
 * untouched (deliberate stops — caps, blackout, consecutive-5xx — remain
 * engagement halts by design); on any other error it appends exactly one
 * directive_failed event carrying the provider cause (describeErrorCause —
 * the ResilienceError message alone is only the classifier's rule name)
 * and returns null, leaving the caller to close the phase with completed
 * work only. coordinatorDirective itself is unchanged.
 */
export async function coordinatorDirectiveOrClose(
  ctx: Ctx,
  kind: "decompose" | "replan",
  context: string,
): Promise<CoordinatorDirective | null> {
  try {
    return await coordinatorDirective(ctx, kind, context);
  } catch (err) {
    if (err instanceof HaltError) throw err;
    const cause = describeErrorCause(err);
    ctx.events.append({
      phase: "exploit",
      actor: "coordinator",
      action: "directive_failed",
      result:
        `${kind} directive call failed: ${(err as Error).message}` +
        (cause !== undefined ? ` Cause: ${cause}` : "") +
        ` — closing the phase with completed work only.`,
    });
    return null;
  }
}
