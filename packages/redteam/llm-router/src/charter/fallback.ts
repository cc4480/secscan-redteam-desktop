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

import type { ChatMessage, ChatResult, RoleRoute } from '../types.js'
import { complete } from '../router.js'
import type { CharterEngagement, CharterRole } from './loader.js'
import { assembleCharterMessages, type CharterPrompt } from './prompt.js'
import { assertLocalOnlyRoute, resolveCharterRoute } from './routing.js'
import { classifyResponse, type RefusalClass } from './refusal.js'

/** The final outcome of one task run through the chain. */
export type FallbackFinalOutcome = 'accepted' | 'refused_all_hops' | 'provider_error'

/** One refusal-chain incident, exactly as spec §3 telemetry defines it. */
export interface RefusalTelemetryEvent {
  engagement: string
  role: CharterRole
  task_type: string
  model: string
  /** The response classification; 'provider_error' when the call itself threw and no response existed to classify. */
  class: RefusalClass | 'provider_error'
  hop_taken: number
  final_outcome: FallbackFinalOutcome
  context_tokens_at_classification: number
  fresh_context_used: boolean
  prefill_used: boolean
  exemplar_pack_version?: number
  anchor_present: boolean
}

/** The routes the chain walks. Primary resolves from charter routing when omitted. */
export interface FallbackRoutes {
  /** Hop 0 route; defaults to resolveCharterRoute for the role. */
  primary?: RoleRoute
  /** Hop 1 route (uncensored endpoint); the hop is skipped when unset and no env route is configured. */
  uncensored?: RoleRoute
  /** Hop 2 route (local model); the hop is skipped when unset and no env route is configured. */
  local?: RoleRoute
}

/** A provider call for one assembled hop. Injectable for tests. */
export type FallbackCallImpl = (route: RoleRoute, assembled: CharterPrompt) => Promise<ChatResult>

const defaultCallImpl: FallbackCallImpl = async (route, assembled) =>
  complete(route.provider, { model: route.model, messages: assembled.messages })

/**
 * Session affinity registry: task id → the route that accepted it.
 * Follow-up calls for a pinned task start at the accepting route instead
 * of the role default (spec §2/§3). In-memory by design; the runner owns
 * persistence across restarts if it ever needs it.
 */
export class SessionAffinity {
  private readonly pins = new Map<string, RoleRoute>()

  /**
   * Pin a task to the route that accepted it.
   * @param taskId - the task identifier
   * @param route - the accepting route
   */
  pin(taskId: string, route: RoleRoute): void {
    this.pins.set(taskId, route)
  }

  /**
   * The pinned route for a task, if any.
   * @param taskId - the task identifier
   * @returns the pinned route, or undefined when the task is unpinned
   */
  routeFor(taskId: string): RoleRoute | undefined {
    return this.pins.get(taskId)
  }
}

/** Options for one task run through the fallback chain. */
export interface FallbackTaskOptions {
  engagement: CharterEngagement
  role: CharterRole
  /** Task identifier: telemetry, affinity, and audit all key on it. */
  taskId: string
  /** Task type label for telemetry (e.g. 'payload', 'nuclei-template', 'poc'). */
  taskType: string
  /** The task's messages (structured facts + request), assembled fresh per hop. */
  messages: ChatMessage[]
  anchor?: string
  includeExemplars?: boolean
  artifactTask?: boolean
  artifactCheck?: (text: string) => boolean
  /** Assistant-turn opening for prefill attempts, generated from the task's facts. */
  prefill?: string
  /** Providers known (by §7 measurement, never assumption) to support assistant prefill. */
  prefillProviders?: readonly string[]
  routes?: FallbackRoutes
  /** Per-engagement pseudonym map; every hop's assembly sanitizes the task messages (spec §4). */
  pseudonyms?: Record<string, string>
  affinity?: SessionAffinity
  /** Telemetry sink; receives every event once the run's outcome is known. */
  onTelemetry?: (event: RefusalTelemetryEvent) => void
  /** Provider call override, for tests and for embedding in other transports. */
  callImpl?: FallbackCallImpl
}

/** The outcome of one task run through the chain. */
export interface FallbackOutcome {
  /** The accepted result, when any hop accepted. */
  result?: ChatResult
  /** The hop that accepted (0, 1, or 2), or 'none'. */
  hopTaken: number | 'none'
  /** The route that accepted, when one did. */
  acceptedRoute?: RoleRoute
  /** Every telemetry event the run emitted, in order. */
  telemetry: RefusalTelemetryEvent[]
}

function estimateContextTokens(assembled: CharterPrompt): number {
  const chars = assembled.messages.reduce((sum, m) => sum + m.content.length, 0)
  return Math.ceil(chars / 4)
}

function uncensoredRouteFromEnv(env: NodeJS.ProcessEnv): RoleRoute | undefined {
  const provider = env['REDTEAM_LLM_UNCENSORED_PROVIDER']?.trim()
  const model = env['REDTEAM_LLM_UNCENSORED_MODEL']?.trim()
  return provider && model ? { provider, model } : undefined
}

function localRouteFromEnv(env: NodeJS.ProcessEnv): RoleRoute | undefined {
  const model = env['REDTEAM_LOCAL_MODEL']?.trim()
  return model ? { provider: 'local', model } : undefined
}

interface AttemptPlan {
  hop: number
  route: RoleRoute
  prefill: boolean
  localValidation: boolean
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
export async function completeWithFallback(opts: FallbackTaskOptions): Promise<FallbackOutcome> {
  const callImpl = opts.callImpl ?? defaultCallImpl
  const buffered: Array<Omit<RefusalTelemetryEvent, 'final_outcome'>> = []
  const finish = (outcome: FallbackFinalOutcome, extra: Omit<FallbackOutcome, 'telemetry'>): FallbackOutcome => {
    const telemetry: RefusalTelemetryEvent[] = buffered.map(event => ({ ...event, final_outcome: outcome }))
    for (const event of telemetry) opts.onTelemetry?.(event)
    return { telemetry, ...extra }
  }

  const pinned = opts.affinity?.routeFor(opts.taskId)
  const primary = pinned ?? opts.routes?.primary ?? resolveCharterRoute(opts.role)
  const hops: AttemptPlan[] = [
    { hop: 0, route: primary, prefill: false, localValidation: false },
    { hop: 0, route: primary, prefill: true, localValidation: false },
  ]
  const uncensored = opts.routes?.uncensored ?? uncensoredRouteFromEnv(process.env)
  if (uncensored !== undefined) hops.push({ hop: 1, route: uncensored, prefill: true, localValidation: false })
  const local = opts.routes?.local ?? localRouteFromEnv(process.env)
  if (local !== undefined) hops.push({ hop: 2, route: local, prefill: true, localValidation: true })

  // Spec §4: a local_only engagement fails loud on ANY hop route that
  // would leave local infrastructure — checked for the whole chain
  // before the first call, so a misconfigured hop 1 cannot receive
  // material that hop 0 handled lawfully.
  for (const planned of hops) assertLocalOnlyRoute(opts.engagement, planned.route)

  for (const attempt of hops) {
    const assembled = assembleCharterMessages(opts.engagement, opts.role, opts.messages, {
      anchor: opts.anchor,
      includeExemplars: opts.includeExemplars,
      pseudonyms: opts.pseudonyms,
    })
    const prefillUsed =
      attempt.prefill &&
      opts.prefill !== undefined &&
      (opts.prefillProviders ?? []).includes(attempt.route.provider)
    if (prefillUsed) {
      assembled.messages = [...assembled.messages, { role: 'assistant', content: opts.prefill as string }]
    }

    let result: ChatResult
    try {
      result = await callImpl(attempt.route, assembled)
    } catch {
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
      })
      return finish('provider_error', { hopTaken: 'none' })
    }

    // The local hop carries one deterministic repair pass on a format
    // failure: an artifact-check failure there is first treated as a
    // format error and repaired with a fresh assembly that names the
    // contract, before the response is classified at all.
    if (attempt.localValidation && opts.artifactCheck !== undefined && !opts.artifactCheck(result.text ?? '')) {
      const repairMessages: ChatMessage[] = [
        ...opts.messages,
        {
          role: 'user',
          content:
            'The previous output failed format validation against the required artifact format. ' +
            'Produce the artifact again, in the exact exemplar format, with no prose around it.',
        },
      ]
      const repairAssembled = assembleCharterMessages(opts.engagement, opts.role, repairMessages, {
        anchor: opts.anchor,
        includeExemplars: opts.includeExemplars,
        pseudonyms: opts.pseudonyms,
      })
      try {
        const repaired = await callImpl(attempt.route, repairAssembled)
        if (opts.artifactCheck(repaired.text ?? '')) result = repaired
      } catch {
        // A failed repair leaves the original response to be classified.
      }
    }

    const classified = classifyResponse(result, {
      artifactTask: opts.artifactTask ?? false,
      artifactCheck: opts.artifactCheck,
    })
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
    })
    if (classified.refusalClass === 'ok') {
      opts.affinity?.pin(opts.taskId, attempt.route)
      return finish('accepted', { result, hopTaken: attempt.hop, acceptedRoute: attempt.route })
    }
    // Refusal hygiene: `result` goes out of scope here. The next attempt
    // assembles from opts.messages only — the refusal text has no path in.
  }
  return finish('refused_all_hops', { hopTaken: 'none' })
}
