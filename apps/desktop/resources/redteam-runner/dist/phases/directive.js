/**
 * Coordinator directive synthesis (v0.19.0 refactor — extracted from phases.ts).
 */
import { COMMAND_TOOLS } from "../tools.js";
import { HaltError } from "../context.js";
import { classifyError, describeErrorCause } from "@secscan/redteam-llm-router";
import { agentLoop, promptCtx } from "../agents.js";
import { coordinatorPrompt } from "../prompts.js";
import { extractJsonBlock } from "../util.js";
import { validateTasks } from "./tasks.js";
export async function coordinatorDirective(ctx, kind, context) {
    const cap = ctx.input.mode === "black" ? 1 : 3;
    const head = kind === "decompose"
        ? `DECOMPOSE — break the operation into small discrete tasks (one task, one specialist, one objective). ` +
            `Fan out independent hypotheses${ctx.input.mode === "black" ? " ONE AT A TIME (black mode: stealth, strictly sequential)" : " in parallel (red mode: up to 3 per round)"}. ` +
            `Put promising leads in their own dedicated tasks. Include registry-informed tasks (fuse what worked before). ` +
            `Tasks must span all three battery categories (logic | functionality | validation) before finish.`
        : `RE-PLAN — the last batch completed. Re-evaluate from the fresh observations: PIVOT to new angles, ESCALATE a promising lead with a dedicated deeper task, ` +
            `GO STEALTHY on detection signals, BACK OFF cooled-down vectors, SPAWN MORE HELP across independent surface. Never coast on the earlier plan.`;
    const text = await agentLoop(ctx, "coordinator", "exploit", coordinatorPrompt(promptCtx(ctx)), `${head}\n\nReturn ONLY a JSON block: {"tasks": [<at most ${cap} task(s) this round>, {"kind": "probe|recon", "brief": "<1-2 sentences>", "attackId": "<ATT&CK, optional>", "category": "<logic|functionality|validation — PROBE TASKS ONLY, omit on recon>", "batteryItem": "<battery item ID this task covers, e.g. SS-042 — PROBE TASKS ONLY, pick a real ID from the pending list, or OMIT>", "codeNeed": "<OPTIONAL, PROBE TASKS ONLY — declare ONLY when the task needs custom code GENERATED (a payload, exploit script, or encoder that no curated library supplies): describe the artifact in one line; the coder seat (TANK) builds it and the exploiter receives it verbatim. Omit for ordinary probes>", "maxTurns": 6}], "finish": <true only when the objective is met AND (battery complete — every battery item verdict-recorded, none pending — OR probe budget exhausted OR no applicable surface declared with reasons)>, "note": "<what changed and why, one line>"}\n\n${context}`, COMMAND_TOOLS, 3, 
    // Q-STRUCT A3: the loop's final text is parsed as JSON (extractJsonBlock
    // below) — constrain the call to object mode; the prose shape above
    // stays canonical (the task fields vary, so no rigid schema).
    { responseFormat: { type: "json_object" } });
    const parsed = extractJsonBlock(text);
    const tasks = validateTasks(ctx, Array.isArray(parsed?.tasks) ? parsed.tasks : [], cap);
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
 * Condense a directive context for the single re-issue after a
 * content-policy rejection: the raw batch dump is what the provider
 * rejected, so the retry carries a structured summary instead — section
 * count and sizes, plus the head (and, for long sections, the tail) of
 * each section — from which the coordinator produces the same directive.
 *
 * @param kind - the directive kind being re-issued
 * @param context - the original, uncondensed directive context
 * @returns the condensed context for the re-issue call
 */
export function condenseDirectiveContext(kind, context) {
    const sections = context.split(/\n\n+/);
    const digest = sections
        .map((section, i) => {
        const flat = section.replace(/\s+/g, " ").trim();
        const excerpt = flat.length > 900 ? `${flat.slice(0, 600)} … ${flat.slice(-300)}` : flat;
        return `[section ${i + 1} of ${sections.length}, ${section.length} chars] ${excerpt}`;
    })
        .join("\n");
    return (`CONDENSED RE-ISSUE — the previous ${kind} directive call was rejected by the provider ` +
        `(content policy). The raw context is replaced by this structured summary; produce the ` +
        `same directive from it.\nContext: ${sections.length} section(s), ${context.length} chars total.\n${digest}`);
}
/**
 * The honest close itself: exactly one directive_failed event carrying
 * the provider cause, and null for the caller to close with.
 *
 * @param ctx - the engagement context
 * @param kind - the directive kind that failed
 * @param err - the final error (after any containment re-issue)
 * @returns null, always
 */
function closeWithDirectiveFailed(ctx, kind, err) {
    const cause = describeErrorCause(err);
    ctx.events.append({
        phase: "exploit",
        actor: "coordinator",
        action: "directive_failed",
        result: `${kind} directive call failed: ${err.message}` +
            (cause !== undefined ? ` Cause: ${cause}` : "") +
            ` — closing the phase with completed work only.`,
    });
    return null;
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
 *
 * One containment step runs before the close (W2): when the failure is
 * classified content_policy, the directive is re-issued ONCE with a
 * condensed context (condenseDirectiveContext — a structured summary,
 * not the raw batch dump that was rejected). The re-issue's outcome is
 * final: success returns the directive, a HaltError rethrows, and any
 * other failure falls into the same honest close, whose single
 * directive_failed event carries that final error's cause.
 */
export async function coordinatorDirectiveOrClose(ctx, kind, context) {
    try {
        return await coordinatorDirective(ctx, kind, context);
    }
    catch (err) {
        if (err instanceof HaltError)
            throw err;
        if (classifyError(err).reason !== "content_policy") {
            return closeWithDirectiveFailed(ctx, kind, err);
        }
        const cause = describeErrorCause(err);
        ctx.events.append({
            phase: "exploit",
            actor: "coordinator",
            action: "directive_reissue",
            result: `${kind} directive call was content-policy rejected` +
                (cause !== undefined ? ` Cause: ${cause}` : "") +
                ` — re-issuing once with a condensed context before closing.`,
        });
        try {
            return await coordinatorDirective(ctx, kind, condenseDirectiveContext(kind, context));
        }
        catch (reissueErr) {
            if (reissueErr instanceof HaltError)
                throw reissueErr;
            return closeWithDirectiveFailed(ctx, kind, reissueErr);
        }
    }
}
//# sourceMappingURL=directive.js.map