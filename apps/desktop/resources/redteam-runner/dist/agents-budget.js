/**
 * The agent loop's stop conditions and tool-call repair steering.
 *
 * Extracted from agents.ts in a structural split (no file under src/ may
 * exceed 300 lines). Moved verbatim: the blackout wait, the ONE permitted
 * SAFETY halt (three consecutive 5xx), the BUDGET stop that closes a phase
 * without halting, the default repair cap, and the repair prompt builder.
 * No condition, threshold or message string changed in the move; agents.ts
 * re-exports DEFAULT_REPAIR_CAP so every existing importer still resolves.
 */
import { inBlackout } from './gate.js';
import { sleep } from './util.js';
// ---------------------------------------------------------------------------
// Stop-condition plumbing
// ---------------------------------------------------------------------------
export async function respectBlackout(ctx, phase) {
    const w = inBlackout(new Date(), ctx.input.roe.blackoutWindows);
    if (!w)
        return;
    ctx.events.append({
        phase,
        actor: 'runner',
        action: 'blackout_pause',
        result: `Entering blackout window ${w.start}–${w.end}${w.tz ? ` ${w.tz}` : ''}. No traffic until it ends.`,
    });
    for (;;) {
        await sleep(30_000);
        if (!inBlackout(new Date(), ctx.input.roe.blackoutWindows))
            break;
    }
    ctx.events.append({ phase, actor: 'runner', action: 'blackout_resume', result: 'Blackout window ended. Resuming.' });
}
/**
 * Q-NOHALT — a SAFETY halt, and the only cap that may still throw.
 *
 * Three consecutive 5xx is evidence of production impact: continuing would
 * keep hitting a service that is already failing, so the run stops
 * deliberately and the report says why. Nothing else in this module halts.
 */
export function safetyHalt(ctx) {
    if (ctx.consecutive5xx >= 3)
        return 'three consecutive 5xx responses — possible production impact, halting';
    return null;
}
/**
 * Q-NOHALT — a BUDGET stop, not a halt.
 *
 * The action and duration caps are configured limits, not target conditions.
 * Hitting one means the engagement ran out of its allowance, so the phase
 * closes with the work already done and the battery records what is still
 * pending — the run finishes and reports. Throwing HaltError here used to
 * discard a whole engagement because a clock or a counter expired.
 */
export function budgetExhausted(ctx) {
    if (ctx.actions >= ctx.config.maxActions)
        return `action cap reached (${ctx.config.maxActions})`;
    if (Date.now() - ctx.startedAt >= ctx.config.maxDurationMs)
        return 'duration cap reached';
    return null;
}
/** Default tool-call repair budget per agentLoop invocation (RC Item 6). */
export const DEFAULT_REPAIR_CAP = 3;
/**
 * The repair steering for one tagged result: the defect, the tool's
 * schema, and the original arguments, per the Item 6 design. The model
 * answers with exactly one corrected call; the name may change only for
 * an unknown-tool defect, and then only to an offered tool.
 */
export function buildRepairPrompt(call, d, tools, spent, cap) {
    const defect = d.repairable ?? '';
    const unknownTool = defect.startsWith('unknown tool');
    const lines = [
        `TOOL-CALL REPAIR (${spent}/${cap}) — a tool call was refused before it executed because the call itself was malformed. ` +
            'This is a call-shape defect, not a policy denial: fix the call and it runs again through every gate.',
        `Tool called: ${call.name}`,
        `Defect: ${defect}`,
        `Original arguments: ${JSON.stringify(call.arguments ?? {})}`,
        `The tool answered: ${d.result}`,
    ];
    if (unknownTool) {
        lines.push('The tool name itself is not one of the offered tools. Answer with the offered tool you actually meant, with corrected arguments.');
        for (const t of tools)
            lines.push(`Offered tool ${t.name}: ${t.description} Parameters: ${JSON.stringify(t.parameters)}`);
    }
    else {
        const tool = tools.find(t => t.name === call.name);
        if (tool)
            lines.push(`Schema for ${tool.name}: ${tool.description} Parameters: ${JSON.stringify(tool.parameters)}`);
        lines.push(`Keep the tool name (${call.name}) — only the arguments may change.`);
    }
    lines.push('Change nothing beyond what the defect requires: same target, same intent. ' +
        'Scope, tier, duplicate, and safety gates all re-run on the corrected call, and a corrected call that trips them is refused for good. ' +
        'Reply with exactly one corrected tool call.');
    return lines.join('\n');
}
//# sourceMappingURL=agents-budget.js.map