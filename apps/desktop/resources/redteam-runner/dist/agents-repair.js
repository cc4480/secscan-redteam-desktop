/**
 * Tool-call repair (RC Item 6) — the bounded repair exchange for one
 * malformed tool call.
 *
 * Extracted from agents.ts in a structural split (no file under src/ may
 * exceed 300 lines). The body is the original closure, moved verbatim: one
 * side-channel completion sees the call and its result, the model answers
 * with one corrected call, and the corrected call re-runs through
 * dispatchTool — every gate — with the corrected result becoming the
 * effective result. The only edits are that the per-loop counters
 * (spent / cap / closed) now travel in the budget object and are read
 * through it; every decision, event string and prompt is unchanged.
 */
import { tokenMeterFor } from './harness2/trajectory-normalize.js';
import { dispatchTool } from './dispatch/router.js';
import { buildRepairPrompt } from './agents-budget.js';
export function createRepairExchange(deps) {
    const { ctx, role, phase, system, tools, complete, steps, budget } = deps;
    return async (call, d) => {
        budget.spent++;
        const defect = d.repairable ?? '';
        const unknownTool = defect.startsWith('unknown tool');
        const logRepair = (outcome, detail) => {
            ctx.events.append({
                phase,
                actor: 'runner',
                action: 'tool_repair',
                target: d.target,
                result: `tool_repair (${budget.spent}/${budget.cap}) outcome=${outcome} — ${detail}`,
            });
        };
        let res;
        try {
            res = await complete(role, [
                { role: 'system', content: system },
                { role: 'assistant', content: '(tool calls)', toolCalls: [call] },
                { role: 'tool', toolCallId: call.id, content: d.result },
                { role: 'user', content: buildRepairPrompt(call, d, tools, budget.spent, budget.cap) },
            ], { tools });
        }
        catch (err) {
            logRepair('error', `the repair completion failed: ${err.message}. Original result stands.`);
            return d;
        }
        tokenMeterFor(ctx).record(res.usage);
        const fix = res.toolCalls && res.toolCalls.length > 0 ? res.toolCalls[0] : undefined;
        if (!fix) {
            budget.closed = true;
            logRepair('no-correction', `the repair exchange for ${call.name} returned no tool call (defect: ${defect}); repair is closed for this loop. Original result stands.`);
            return d;
        }
        if (!unknownTool && fix.name !== call.name) {
            logRepair('failed', `the corrected call names ${fix.name}, not ${call.name} — the tool name may change only for an unknown-tool defect (this defect: ${defect}). Original result stands.`);
            return d;
        }
        if (unknownTool && tools.length > 0 && !tools.some(t => t.name === fix.name)) {
            logRepair('failed', `the corrected call names ${fix.name}, which is not one of the offered tools. Original result stands.`);
            return d;
        }
        steps.tool(fix.name, JSON.stringify(fix.arguments ?? {}));
        const corrected = await dispatchTool(ctx, role, phase, fix);
        if (corrected.repairable === undefined && !/^(DENIED|HALTED)/i.test(corrected.result)) {
            logRepair('repaired', `${call.name} defect: ${defect}; corrected call ${fix.name} re-dispatched and executed: ${corrected.result.slice(0, 300)}`);
            return corrected;
        }
        logRepair('failed', `corrected call ${fix.name} was refused: ${corrected.result.slice(0, 300)}. Original result stands.`);
        return d;
    };
}
//# sourceMappingURL=agents-repair.js.map