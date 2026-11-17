/**
 * The refusal fallback chain (spec §3), with refusal hygiene enforced by
 * construction: every attempt's context is assembled fresh from the
 * task's structured inputs (engagement record, role, anchor, task
 * messages). A refused response is classified, recorded for telemetry,
 * and then dropped — it is never an input to any later assembly, so
 * there is no code path by which refusal text can reach a retry's
 * context.
 *
 * Hop order: 0 fresh-context retry on the primary route (with assistant
 * prefill where the provider is known to support it), 1 the configured
 * uncensored endpoint, 2 the local model with strict format validation
 * and one repair pass. Once a hop accepts, the task is pinned to that
 * route (session affinity) for its follow-ups.
 *
 * Telemetry events are buffered per run and emitted once the run's final
 * outcome is known, because the event schema carries that outcome; the
 * buffer is also the return value, so sink and caller see the same facts.
 */
import { complete } from '../router.js';
import { assembleCharterMessages } from './prompt.js';
import { assertLocalOnlyRoute, resolveCharterRoute } from './routing.js';
import { classifyResponse } from './refusal.js';
const defaultCallImpl = async (route, assembled) => complete(route.provider, { model: route.model, messages: assembled.messages });
/**
 * Session affinity registry: task id → the route that accepted it.
 * Follow-up calls for a pinned task start at the accepting route instead
 * of the role default (spec §2/§3). In-memory by design; the runner owns
 * persistence across restarts if it ever needs it.
 */
export class SessionAffinity {
    pins = new Map();
    /**
     * Pin a task to the route that accepted it.
     * @param taskId - the task identifier
     * @param route - the accepting route
     */
    pin(taskId, route) {
        this.pins.set(taskId, route);
    }
    /**
     * The pinned route for a task, if any.
     * @param taskId - the task identifier
     * @returns the pinned route, or undefined when the task is unpinned
     */
    routeFor(taskId) {
        return this.pins.get(taskId);
    }
}
function estimateContextTokens(assembled) {
    const chars = assembled.messages.reduce((sum, m) => sum + m.content.length, 0);
    return Math.ceil(chars / 4);
}
function uncensoredRouteFromEnv(env) {
    const provider = env['REDTEAM_LLM_UNCENSORED_PROVIDER']?.trim();
    const model = env['REDTEAM_LLM_UNCENSORED_MODEL']?.trim();
    return provider && model ? { provider, model } : undefined;
}
function localRouteFromEnv(env) {
    const model = env['REDTEAM_LOCAL_MODEL']?.trim();
    return model ? { provider: 'local', model } : undefined;
}
/**
 * Run one task through the refusal fallback chain.
 *
 * Each attempt assembles a brand-new context from the task's structured
 * inputs; a classified refusal is recorded and discarded. Provider
 * errors (throws) are NOT refusals: they abort the chain with a
 * `provider_error` outcome rather than masquerading as content the
 * model declined to produce.
 *
 * @param opts - the task and chain options
 * @returns the accepted result, the hop that accepted, and all telemetry
 */
export async function completeWithFallback(opts) {
    const callImpl = opts.callImpl ?? defaultCallImpl;
    const buffered = [];
    const finish = (outcome, extra) => {
        const telemetry = buffered.map(event => ({ ...event, final_outcome: outcome }));
        for (const event of telemetry)
            opts.onTelemetry?.(event);
        return { telemetry, ...extra };
    };
    const pinned = opts.affinity?.routeFor(opts.taskId);
    const primary = pinned ?? opts.routes?.primary ?? resolveCharterRoute(opts.role);
    const hops = [
        { hop: 0, route: primary, prefill: false, localValidation: false },
        { hop: 0, route: primary, prefill: true, localValidation: false },
    ];
    const uncensored = opts.routes?.uncensored ?? uncensoredRouteFromEnv(process.env);
    if (uncensored !== undefined)
        hops.push({ hop: 1, route: uncensored, prefill: true, localValidation: false });
    const local = opts.routes?.local ?? localRouteFromEnv(process.env);
    if (local !== undefined)
        hops.push({ hop: 2, route: local, prefill: true, localValidation: true });
    // Spec §4: a local_only engagement fails loud on ANY hop route that
    // would leave local infrastructure — checked for the whole chain
    // before the first call, so a misconfigured hop 1 cannot receive
    // material that hop 0 handled lawfully.
    for (const planned of hops)
        assertLocalOnlyRoute(opts.engagement, planned.route);
    for (const attempt of hops) {
        const assembled = assembleCharterMessages(opts.engagement, opts.role, opts.messages, {
            anchor: opts.anchor,
            includeExemplars: opts.includeExemplars,
            pseudonyms: opts.pseudonyms,
        });
        const prefillUsed = attempt.prefill &&
            opts.prefill !== undefined &&
            (opts.prefillProviders ?? []).includes(attempt.route.provider);
        if (prefillUsed) {
            assembled.messages = [...assembled.messages, { role: 'assistant', content: opts.prefill }];
        }
        let result;
        try {
            result = await callImpl(attempt.route, assembled);
        }
        catch {
            buffered.push({
                engagement: opts.engagement.engagementId,
                role: opts.role,
                task_type: opts.taskType,
                model: attempt.route.model,
                class: 'provider_error',
                hop_taken: attempt.hop,
                context_tokens_at_classification: estimateContextTokens(assembled),
                fresh_context_used: true,
                prefill_used: prefillUsed,
                exemplar_pack_version: assembled.exemplarPackVersion,
                anchor_present: assembled.anchorPresent,
            });
            return finish('provider_error', { hopTaken: 'none' });
        }
        // The local hop carries one deterministic repair pass on a format
        // failure: an artifact-check failure there is first treated as a
        // format error and repaired with a fresh assembly that names the
        // contract, before the response is classified at all.
        if (attempt.localValidation && opts.artifactCheck !== undefined && !opts.artifactCheck(result.text ?? '')) {
            const repairMessages = [
                ...opts.messages,
                {
                    role: 'user',
                    content: 'The previous output failed format validation against the required artifact format. ' +
                        'Produce the artifact again, in the exact exemplar format, with no prose around it.',
                },
            ];
            const repairAssembled = assembleCharterMessages(opts.engagement, opts.role, repairMessages, {
                anchor: opts.anchor,
                includeExemplars: opts.includeExemplars,
                pseudonyms: opts.pseudonyms,
            });
            try {
                const repaired = await callImpl(attempt.route, repairAssembled);
                if (opts.artifactCheck(repaired.text ?? ''))
                    result = repaired;
            }
            catch {
                // A failed repair leaves the original response to be classified.
            }
        }
        const classified = classifyResponse(result, {
            artifactTask: opts.artifactTask ?? false,
            artifactCheck: opts.artifactCheck,
        });
        buffered.push({
            engagement: opts.engagement.engagementId,
            role: opts.role,
            task_type: opts.taskType,
            model: attempt.route.model,
            class: classified.refusalClass,
            hop_taken: attempt.hop,
            context_tokens_at_classification: result.usage?.promptTokens ?? estimateContextTokens(assembled),
            fresh_context_used: true,
            prefill_used: prefillUsed,
            exemplar_pack_version: assembled.exemplarPackVersion,
            anchor_present: assembled.anchorPresent,
        });
        if (classified.refusalClass === 'ok') {
            opts.affinity?.pin(opts.taskId, attempt.route);
            return finish('accepted', { result, hopTaken: attempt.hop, acceptedRoute: attempt.route });
        }
        // Refusal hygiene: `result` goes out of scope here. The next attempt
        // assembles from opts.messages only — the refusal text has no path in.
    }
    return finish('refused_all_hops', { hopTaken: 'none' });
}
