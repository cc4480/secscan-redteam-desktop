/**
 * Charter completion — the live wiring of the fleet charter (spec §2/§3)
 * into the agent loop.
 *
 * agentLoop drives every fleet agent through one completion seam. When
 * the caller does not inject a completion (production), this module's
 * factory supplies it, and every call is a chartered call:
 *
 *   - The charter is assembled once, at the head of the loop's messages:
 *     charter first, the phase persona after it, per spec §2. The
 *     assembled head replaces the loop's initial messages in place, so
 *     it persists across the loop's turns without re-assembly.
 *   - The seat's route is charter routing as data (resolveCharterRoute),
 *     not the bare role policy.
 *   - At each phase's first chartered loop, the agent's phase anchor is
 *     elicited (the four marker questions, answered from the engagement
 *     record) and carried into the assembly (SCAN re-anchoring, spec
 *     §2). A phase whose elicitation fails proceeds without an anchor
 *     and the absence is recorded in the audit trail — the spec's flag,
 *     never a silent skip and never a blocked engagement.
 *   - Every response is classified. An explicit refusal with no tool
 *     calls runs the spec §3 fallback chain (fresh contexts, refusal
 *     hygiene: the refused text is never written into the loop's
 *     messages, notes, or events). Telemetry lands in the engagement
 *     audit trail. When every hop refuses, the turn returns an empty
 *     result and the loop's own idle/deliverable machinery decides what
 *     happens next — the refusal itself never becomes context.
 *
 * Known limitation (spec §4): no per-engagement pseudonym map is built
 * yet, so assembly runs without pseudonymization; the runner's existing
 * PII redaction on tool outputs and evidence still applies.
 */
import {
  assembleCharterMessages,
  assertLocalOnlyRoute,
  buildPhaseAnchor,
  CHARTER_MARKER_QUESTIONS,
  classifyResponse,
  complete,
  completeWithCharter,
  completeWithFallback,
  resolveCharterRoute,
  SessionAffinity,
  type AgentRole,
  type CharterEngagement,
  type CharterRole,
  type ChatMessage,
  type ChatResult,
  type FallbackCallImpl,
  type JsonSchemaTool,
  type RoleRoute,
} from '@secscan/redteam-llm-router'
import { type Ctx } from './context.js'
import { type EngagementPhase } from './types.js'

/** Which charter seat each agent role sits in (inverse of CHARTER_ROLE_AGENT_ROLE). */
const AGENT_TO_CHARTER: Readonly<Record<AgentRole, CharterRole>> = {
  coordinator: 'coordinator',
  recon: 'recon',
  exploiter: 'exploiter-operator',
  reporter: 'reporter',
}

const engagementCache = new WeakMap<Ctx, CharterEngagement>()
const affinityCache = new WeakMap<Ctx, SessionAffinity>()
const anchorCache = new WeakMap<Ctx, Map<string, Promise<string | undefined>>>()

/**
 * The charter engagement record for one run, filled from what the runner
 * actually holds. Every field is required by the charter loader, so each
 * fallback states plainly what the record does and does not contain —
 * nothing is invented (an attestation is labeled an attestation).
 *
 * @param ctx - the engagement context
 * @returns the charter engagement record for this run
 */
export function charterEngagementFor(ctx: Ctx): CharterEngagement {
  const cached = engagementCache.get(ctx)
  if (cached) return cached
  const engagement: CharterEngagement = {
    engagementId: `${ctx.domain || 'engagement'}-${ctx.startedAt}`,
    owner: ctx.input.client ?? ctx.input.operatorName ?? ctx.domain ?? 'target owner (not named on the record)',
    proofMethod: ctx.verificationProof ?? 'operator-attested ownership (no verification proof on record)',
    inScope: ctx.hosts.length > 0 ? ctx.hosts.join(', ') : ctx.input.target,
  }
  engagementCache.set(ctx, engagement)
  return engagement
}

function affinityFor(ctx: Ctx): SessionAffinity {
  let affinity = affinityCache.get(ctx)
  if (!affinity) {
    affinity = new SessionAffinity()
    affinityCache.set(ctx, affinity)
  }
  return affinity
}

/** The per-call options a completion receives (completeForRole's shape). */
export interface CharteredCallOptions {
  tools?: JsonSchemaTool[]
  signal?: AbortSignal
  maxTokens?: number
  temperature?: number
}

/** Injectable provider seam for tests; production uses the router registry. */
export interface CharteredCallSeams {
  /** Raw provider call for one resolved route. */
  call?: (route: RoleRoute, messages: ChatMessage[], opts: CharteredCallOptions) => Promise<ChatResult>
  /** Fallback-chain call implementation (defaults to the chain's own). */
  fallbackCall?: FallbackCallImpl
  /** Chartered single-shot call, used for anchor elicitation. */
  elicitationCall?: (engagement: CharterEngagement, role: CharterRole, messages: ChatMessage[]) => Promise<ChatResult>
}

type CompleteForRole = (role: AgentRole, messages: ChatMessage[], opts?: CharteredCallOptions) => Promise<ChatResult>

async function elicitAnchor(
  ctx: Ctx,
  phase: EngagementPhase,
  role: CharterRole,
  engagement: CharterEngagement,
  seams: CharteredCallSeams,
): Promise<string | undefined> {
  const questionList = CHARTER_MARKER_QUESTIONS.map(q => `${q.key}: ${q.question}`).join('\n')
  const prompt =
    'Before this phase begins, answer the four charter marker questions from the engagement record. ' +
    `Reply with exactly one line per question, in the form "<key>: <answer>", no other text.\n${questionList}`
  try {
    const call =
      seams.elicitationCall ??
      ((eng: CharterEngagement, r: CharterRole, msgs: ChatMessage[]) =>
        completeWithCharter({ engagement: eng, role: r, messages: msgs }))
    const res = await call(engagement, role, [{ role: 'user', content: prompt }])
    const answers: Record<string, string> = {}
    for (const line of (res.text ?? '').split('\n')) {
      const m = /^(engagement|scope|objective|artifact):\s*(.+)$/.exec(line.trim())
      if (m) answers[m[1]] = m[2].trim()
    }
    const anchor = buildPhaseAnchor(answers as Parameters<typeof buildPhaseAnchor>[0])
    ctx.events.append({
      phase,
      actor: 'runner',
      action: 'phase_anchor',
      result: `Phase anchor elicited for ${phase} (${role}): ${anchor.split('\n').join(' | ').slice(0, 300)}`,
    })
    return anchor
  } catch (err) {
    ctx.events.append({
      phase,
      actor: 'runner',
      action: 'phase_anchor_missing',
      result: `Phase ${phase} starts without a recorded anchor (spec flag): ${(err as Error).message}`,
    })
    return undefined
  }
}

function anchorFor(
  ctx: Ctx,
  phase: EngagementPhase,
  role: CharterRole,
  engagement: CharterEngagement,
  seams: CharteredCallSeams,
): Promise<string | undefined> {
  let byPhase = anchorCache.get(ctx)
  if (!byPhase) {
    byPhase = new Map()
    anchorCache.set(ctx, byPhase)
  }
  let pending = byPhase.get(phase)
  if (!pending) {
    pending = elicitAnchor(ctx, phase, role, engagement, seams)
    byPhase.set(phase, pending)
  }
  return pending
}

/**
 * Build the production completion for one agentLoop invocation: a
 * drop-in for the router's completeForRole that charters the call.
 *
 * @param ctx - the engagement context (engagement record, audit trail)
 * @param phase - the phase this loop serves (anchor + telemetry keying)
 * @param seams - test seams; production passes none
 * @returns a completion with completeForRole's signature
 */
export function createCharteredComplete(
  ctx: Ctx,
  phase: EngagementPhase,
  seams: CharteredCallSeams = {},
): CompleteForRole {
  const engagement = charterEngagementFor(ctx)
  let route: RoleRoute | undefined
  let assembled = false

  return async (role, messages, opts = {}) => {
    const charterRole = AGENT_TO_CHARTER[role]
    if (!route) {
      route = resolveCharterRoute(charterRole)
      assertLocalOnlyRoute(engagement, route)
    }
    if (!assembled) {
      const anchor = await anchorFor(ctx, phase, charterRole, engagement, seams)
      const prompt = assembleCharterMessages(engagement, charterRole, messages, { anchor })
      messages.splice(0, messages.length, ...prompt.messages)
      assembled = true
    }
    const call =
      seams.call ??
      ((r: RoleRoute, msgs: ChatMessage[], o: CharteredCallOptions) =>
        complete(r.provider, {
          model: r.model,
          messages: msgs,
          tools: o.tools,
          reasoningEffort: r.reasoningEffort,
          signal: o.signal,
          maxTokens: o.maxTokens,
          temperature: o.temperature,
        }))
    const result = await call(route, messages, opts)
    // Refusal gate: only a tool-less response can be a refusal outcome —
    // a response that acts is an answer, whatever its prose says.
    if (result.toolCalls && result.toolCalls.length > 0) return result
    const classified = classifyResponse(result, { artifactTask: false })
    if (classified.refusalClass === 'ok') return result

    ctx.events.append({
      phase,
      actor: 'runner',
      action: 'refusal_detected',
      result: `${role} response classified ${classified.refusalClass} (${classified.reason}) — running the fallback chain; the refused text is excluded from context.`,
    })
    const firstUser = messages.find(m => m.role === 'user')
    const last = messages[messages.length - 1]
    const taskMessages: ChatMessage[] = []
    if (firstUser) taskMessages.push({ role: 'user', content: firstUser.content })
    if (last && last !== firstUser && last.role !== 'assistant') {
      taskMessages.push({
        role: 'user',
        content: `Current step context (latest observation, condensed by the runner):\n${last.content.slice(0, 4000)}`,
      })
    }
    const anchor = await anchorFor(ctx, phase, charterRole, engagement, seams)
    const outcome = await completeWithFallback({
      engagement,
      role: charterRole,
      taskId: `${engagement.engagementId}:${phase}:${role}`,
      taskType: phase,
      messages: taskMessages,
      anchor,
      affinity: affinityFor(ctx),
      callImpl: seams.fallbackCall,
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
    return { text: '', toolCalls: [], provider: route.provider, model: route.model }
  }
}
