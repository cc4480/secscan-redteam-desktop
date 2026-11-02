/**
 * Layer-2 skill loading for the load_skill tool (fleet audit M4): the
 * Layer-1 index in every seat's prompt promises the full SKILL.md body
 * on trigger; this module is the path that keeps the promise. Kept as
 * its own handler module (the bridge/pc-agent pattern) because
 * bookkeeping.ts sits at the file budget. Resolution mirrors prompt
 * assembly — same fleet package root, same discovery — so the body a
 * seat loads mid-engagement is byte-identical to the body assembly
 * binds at prompt time. Errors are plain results (the loader's message
 * lists what exists), never a throw into the loop.
 */
import { join } from 'node:path';
import { loadSkillBodyByName } from '@secscan/redteam-fleet-skills';
import { fleetPackageRoot } from '../prompts/fleet-assembly.js';
import { optStr } from './prelude.js';
/**
 * Load one skill body by its index name (mechanical; unit-tested).
 *
 * @param name - the exact skill name from the fleet skills index, or
 *   undefined when the caller supplied none
 * @returns the full SKILL.md text, or a plain-language error (missing
 *   name, or the loader's own message naming the miss and listing the
 *   available skills)
 */
export function loadSkill(name) {
    if (!name) {
        return {
            ok: false,
            error: 'load_skill: a skill name is required — use the exact name from the fleet skills index in your prompt.',
        };
    }
    try {
        return { ok: true, body: loadSkillBodyByName([join(fleetPackageRoot(), 'skills')], name) };
    }
    catch (e) {
        return { ok: false, error: `load_skill: ${e.message}` };
    }
}
/**
 * Claim load_skill calls for the dispatch chain.
 *
 * @returns the skill body (or a plain-language error) as the tool
 *   result; null for every other tool name
 */
export async function handleSkillLoadTools(_ctx, _role, _phase, call, args) {
    if (call.name !== 'load_skill')
        return null;
    const r = loadSkill(optStr(args['name']));
    return { result: r.ok ? r.body : r.error, target: 'skills' };
}
//# sourceMappingURL=skill-load.js.map