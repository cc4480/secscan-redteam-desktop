/**
 * promptCtx — the prompt-assembly input every role's system prompt is
 * built from.
 *
 * Extracted verbatim from agents.ts in a structural split (no file under
 * src/ may exceed 300 lines). Pure: it reads the context (mode, objective,
 * target, scope, ROE, battery, memory start pack, stamped verification
 * record) and shapes the PromptContext; it holds no state and calls no
 * target. agents.ts re-exports the name, so importers are unaffected.
 */
import { isPrivateOrLoopbackHost } from './prober.js';
import { verifiedRecordFor } from './prompts/fleet-assembly.js';
import { memoryStateFor } from './memory/lifecycle.js';
export function promptCtx(ctx) {
    return {
        mode: ctx.input.mode,
        objective: ctx.input.objective,
        target: ctx.input.target,
        scopeHosts: ctx.hosts,
        roe: ctx.input.roe,
        fullBattery: ctx.input.fullBattery,
        targets: ctx.input.targets,
        // Only actually relax discipline when the target is genuinely
        // loopback/private — matches the gate's invariant exactly. Leaving
        // --local-sandbox on does nothing against a real domain.
        localSandbox: ctx.config.localSandbox && ctx.hosts.every(h => isPrivateOrLoopbackHost(h)),
        // TEST MODE: posture flag for the role prompts (roeBlock states it).
        testMode: ctx.config.testMode,
        // Q-MEMTIER (§7.1): the recall start pack, when memory was opened
        // and the pack assembled (post-authorize). It reaches the system
        // prompts through memoryBlock and is journaled with them.
        memoryBrief: memoryStateFor(ctx)?.startPack?.text,
        // Phase 2 W3: the fleet prompt-assembly input, built from the
        // AUTHORIZE phase's stamped verification record when authorize has
        // stamped one. Production runs are gated in runEngagement: it calls
        // verifiedRecordFor immediately after a successful authorize and
        // fails loud there, so a live engagement never reaches promptCtx
        // without its record. Direct phase calls on hand-built contexts
        // (unit fixtures) carry no record and render the historical seat
        // text. The runner has no CHARTER / ENGAGEMENT knob files, so the
        // knob sources stay unset and the fleet package's defaults govern.
        ...(ctx.verificationProof && ctx.verifiedAt
            ? { fleet: { record: verifiedRecordFor(ctx) } }
            : {}),
    };
}
//# sourceMappingURL=agents-prompt-ctx.js.map