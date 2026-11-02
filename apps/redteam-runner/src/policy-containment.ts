/**
 * Policy containment — the recovery paths for a chartered call whose
 * provider refuses it, extracted from charter-completion.ts.
 *
 * Two refusal shapes land here:
 *
 *   - The spec §3 fallback chain (createFallbackRunner): a call whose
 *     response is classified as a refusal — or whose thrown-policy
 *     containment also failed — is re-run through fresh contexts with
 *     refusal hygiene (the refused text never becomes context), and
 *     every hop's telemetry lands in the engagement audit trail.
 *   - Thrown-policy containment (callWithPolicyContainment): a provider
 *     that THROWS its content-policy rejection instead of returning
 *     refusal prose is contained at the call — logged with its full
 *     provider cause, re-issued once with the verified engagement
 *     record attached and the step context condensed to a structured
 *     summary (condensedReissueMessages), and routed into the §3 chain
 *     when the re-issue is rejected too. Non-policy errors propagate.
 */
import {
  classifyError,
  completeWithFallback,
  describeErrorCause,
  SessionAffinity,
  type AgentRole,
  type CharterEngagement,
  type CharterRole,
  type ChatMessage,
  type ChatResult,
  type FallbackCallImpl,
  type RoleRoute,
} from '@secscan/redteam-llm-router'
import { buildEngagementInjection } from '@secscan/redteam-fleet-skills'
import { type CharteredCallOptions } from './charter-completion.js'
import { type Ctx } from './context.js'
import { verifiedRecordFor } from './prompts/fleet-assembly.js'
import { type EngagementPhase } from './types.js'

/**
 * Build the condensed re-issue for a call the provider content-policy
 * rejected: the chartered system head, then ONE user message carrying
 * the verified engagement record and a structured summary of the step
 * (first instruction + latest context, both truncated) in place of the
 * full prior context — the raw batch dump is what was rejected, and
 * resending it unchanged would be rejected again. The record block is
 * the standard fleet injection itself — buildEngagementInjection over
 * the context's verified record, the same sanitized block the normal
 * assembly path renders (targets, proof with its verification stamp,
 * RoE, session rule) — never a hand-rendered subset: a thin or
 * unsanitized copy would hand the recovered call a weaker record than
 * the refused one had, and a field an attacker can echo could spoof
 * the block's structure.
 *
 * @param messages - the rejected call's (chartered) messages
 * @param ctx - the engagement context (the verified record's source)
 * @returns the condensed message list for the single re-issue
 */
export function condensedReissueMessages(
  messages: ChatMessage[],
  ctx: Ctx,
): ChatMessage[] {
  const system = messages.find(m => m.role === 'system')
  const firstUser = messages.find(m => m.role === 'user')
  const last = messages[messages.length - 1]
  const record = buildEngagementInjection(verifiedRecordFor(ctx))
  const summary: string[] = [
    'CONDENSED RE-ISSUE — the previous attempt at this step was rejected by the provider content policy, so the full prior context is replaced by the verified engagement record above and this structured summary. Continue the same step and produce the same deliverable the original call asked for.',
    `Context condensed: ${messages.length} message(s) summarized below.`,
  ]
  if (firstUser) {
    summary.push(`Step instruction (condensed):\n${firstUser.content.slice(0, 1200)}`)
  }
  if (last && last !== firstUser) {
    summary.push(`Latest step context (condensed):\n${last.content.slice(0, 1200)}`)
  }
  return [
    ...(system ? [{ role: 'system' as const, content: system.content }] : []),
    { role: 'user' as const, content: `${record}\n\n${summary.join('\n\n')}` },
  ]
}

/** The call context {@link createFallbackRunner} feeds the §3 chain from. */
export interface FallbackRunnerDeps {
  /** The engagement context (audit trail). */
  ctx: Ctx
  /** The phase the refused call serves (telemetry keying). */
  phase: EngagementPhase
  /** The agent role the refused call serves. */
  role: AgentRole
  /** The charter seat the agent role sits in. */
  charterRole: CharterRole
  /** The charter engagement record for this run. */
  engagement: CharterEngagement
  /** The refused call's (chartered) messages. */
  messages: ChatMessage[]
  /** The refused call's resolved route (provider/model for the empty result). */
  resolvedRoute: RoleRoute
  /**
   * Whether the refused call's task must produce an artifact (M6):
   * forwarded into the §3 chain so its hops classify with the same
   * artifact expectations as the gate that entered it. Absent = the
   * chain's default (not an artifact task).
   */
  artifactTask?: boolean
  /**
   * The artifact check for the refused call's task (M6): forwarded
   * with {@link FallbackRunnerDeps.artifactTask}; the chain's hops and
   * its format-repair pass apply it exactly as the primary gate does.
   */
  artifactCheck?: (text: string) => boolean
  /** Fallback-chain call implementation seam; the chain supplies its own when absent. */
  fallbackCall?: FallbackCallImpl
  /** Elicit (or fetch the cached) phase anchor for this call. */
  elicitAnchor: () => Promise<string | undefined>
}

const affinityCache = new WeakMap<Ctx, SessionAffinity>()

/**
 * The run's session affinity for the fallback chain, one per context.
 *
 * @param ctx - the engagement context
 * @returns the context's cached affinity, created on first use
 */
function affinityFor(ctx: Ctx): SessionAffinity {
  let affinity = affinityCache.get(ctx)
  if (!affinity) {
    affinity = new SessionAffinity()
    affinityCache.set(ctx, affinity)
  }
  return affinity
}

/**
 * The spec §3 fallback chain for one call, fed from the call's own
 * messages. Shared by the prose-refusal gate and the thrown-policy
 * containment: both end here rather than dying.
 *
 * @param deps - the refused call's context (see {@link FallbackRunnerDeps})
 * @returns a runner that resolves to the recovered result, or the empty turn-end result
 */
export function createFallbackRunner(deps: FallbackRunnerDeps): () => Promise<ChatResult> {
  const { ctx, phase, role, charterRole, engagement, messages, resolvedRoute } = deps
  return async (): Promise<ChatResult> => {
    const system = messages.find(m => m.role === 'system')
    const firstUser = messages.find(m => m.role === 'user')
    const last = messages[messages.length - 1]
    const taskMessages: ChatMessage[] = []
    // The original system message leads: it is the assembled fleet
    // prompt (soul, skills, engagement record) the refused call ran
    // under. A chain rebuilt from user messages alone would recover a
    // thinner agent than the one that was refused — no seat identity,
    // no record. The chain treats a system task message as persona
    // after its own charter, exactly as the chartered primary call
    // treats the persona it is handed.
    if (system) taskMessages.push({ role: 'system', content: system.content })
    if (firstUser) taskMessages.push({ role: 'user', content: firstUser.content })
    if (last && last !== firstUser && last.role !== 'assistant') {
      taskMessages.push({
        role: 'user',
        content: `Current step context (latest observation, condensed by the runner):\n${last.content.slice(0, 4000)}`,
      })
    }
    const anchor = await deps.elicitAnchor()
    const outcome = await completeWithFallback({
      engagement,
      role: charterRole,
      taskId: `${engagement.engagementId}:${phase}:${role}`,
      taskType: phase,
      messages: taskMessages,
      anchor,
      ...(deps.artifactTask !== undefined ? { artifactTask: deps.artifactTask } : {}),
      ...(deps.artifactCheck ? { artifactCheck: deps.artifactCheck } : {}),
      affinity: affinityFor(ctx),
      callImpl: deps.fallbackCall,
      onTelemetry: (event) => {
        ctx.events.append({
          phase,
          actor: 'runner',
          action: 'refusal_telemetry',
          result:
            `role=${event.role} task=${event.task_type} model=${event.model} class=${event.class} ` +
            `hop=${event.hop_taken} outcome=${event.final_outcome} fresh=${event.fresh_context_used} ` +
            `prefill=${event.prefill_used} anchor=${event.anchor_present}`,
        })
      },
    })
    if (outcome.result) return outcome.result
    ctx.events.append({
      phase,
      actor: 'runner',
      action: 'refusal_all_hops',
      result: `Every fallback hop refused or failed for ${role} in ${phase}; the turn ends empty rather than carrying refusal text forward.`,
    })
    return { text: '', toolCalls: [], provider: resolvedRoute.provider, model: resolvedRoute.model }
  }
}

/** The call context {@link callWithPolicyContainment} contains a rejection for. */
export interface PolicyContainmentDeps {
  /** The provider call seam for the resolved route. */
  call: (route: RoleRoute, messages: ChatMessage[], opts: CharteredCallOptions) => Promise<ChatResult>
  /** The call's resolved route. */
  route: RoleRoute
  /** The call's (chartered) messages. */
  messages: ChatMessage[]
  /** The per-call options the completion received. */
  opts: CharteredCallOptions
  /** The charter engagement record for this run. */
  engagement: CharterEngagement
  /** The engagement context (audit trail). */
  ctx: Ctx
  /** The phase the call serves (telemetry keying). */
  phase: EngagementPhase
  /** The agent role the call serves. */
  role: AgentRole
  /** The §3 fallback chain for this call, entered when containment also fails. */
  runFallback: () => Promise<ChatResult>
}

/**
 * How a contained call ended: `result` carries a provider result the
 * caller continues with (the refusal gate still applies); `fallback`
 * carries the §3 chain's result, which the caller returns as-is.
 */
export type PolicyContainmentOutcome =
  | { kind: 'result'; result: ChatResult }
  | { kind: 'fallback'; result: ChatResult }

/**
 * Run one chartered call under thrown-policy containment: a provider
 * that throws its safety rejection (instead of returning refusal
 * prose) is contained at this call — logged with its full provider
 * cause, re-issued once condensed with the engagement record attached,
 * and routed into the §3 fallback chain when the re-issue is rejected
 * too. Non-policy errors keep their historical behavior and propagate.
 *
 * @param deps - the call's context (see {@link PolicyContainmentDeps})
 * @returns the contained outcome (see {@link PolicyContainmentOutcome})
 */
export async function callWithPolicyContainment(
  deps: PolicyContainmentDeps,
): Promise<PolicyContainmentOutcome> {
  const { call, route, messages, opts, ctx, phase, role, runFallback } = deps
  let result: ChatResult
  try {
    result = await call(route, messages, opts)
  } catch (err) {
    // Thrown-policy containment: a provider that THROWS its safety
    // rejection (instead of returning refusal prose) used to bypass
    // the §3 chain entirely — there was no try/catch here. Policy
    // rejections are contained at this call; every other error class
    // propagates exactly as before.
    if (classifyError(err).reason !== 'content_policy') throw err
    const cause = describeErrorCause(err) ?? (err as Error).message
    ctx.events.append({
      phase,
      actor: 'runner',
      action: 'policy_containment',
      result:
        `${role} completion threw a content-policy rejection — containing at this call: ` +
        `re-issuing once with the engagement record attached and the step context condensed. Cause: ${cause}`,
    })
    try {
      result = await call(route, condensedReissueMessages(messages, ctx), opts)
      ctx.events.append({
        phase,
        actor: 'runner',
        action: 'policy_reissue_recovered',
        result: `Condensed re-issue recovered the ${role} call after a content-policy rejection.`,
      })
    } catch (reissueErr) {
      if (classifyError(reissueErr).reason !== 'content_policy') throw reissueErr
      const reissueCause = describeErrorCause(reissueErr) ?? (reissueErr as Error).message
      ctx.events.append({
        phase,
        actor: 'runner',
        action: 'policy_containment_failed',
        result:
          `Condensed re-issue for ${role} was also content-policy rejected — routing to the fallback chain. ` +
          `Cause: ${reissueCause}`,
      })
      return { kind: 'fallback', result: await runFallback() }
    }
  }
  return { kind: 'result', result }
}
