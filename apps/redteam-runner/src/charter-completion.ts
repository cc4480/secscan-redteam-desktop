/**
 * Charter completion — the live wiring of the fleet charter (spec §2/§3)
 * into the agent loop.
 *
 * agentLoop drives every fleet agent through one completion seam. When
 * the caller does not inject a completion (production), this module's
 * factory supplies it, and every call is a chartered call:
 *
 *   - The charter is assembled at the head of EVERY call's messages:
 *     charter first, the phase persona after it, per spec §2. The
 *     assembled head replaces the call's initial messages in place, so
 *     it persists across the loop's turns without re-assembly — and
 *     side calls that build fresh message arrays (reflector verdicts,
 *     tool-call repair) are chartered too, idempotently: an array is
 *     never spliced twice.
 *   - The seat's route is charter routing as data (resolveCharterRoute),
 *     not the bare role policy.
 *   - At each phase's first chartered loop, the agent's phase anchor is
 *     elicited (the four marker questions, answered from the engagement
 *     record) and carried into the assembly (SCAN re-anchoring, spec
 *     §2). A phase whose elicitation fails proceeds without an anchor
 *     and the absence is recorded in the audit trail — the spec's flag,
 *     never a silent skip and never a blocked engagement.
 *   - Every response is classified, with the real artifact flag for
 *     artifact-producing phases (report/scribe — M6), so a soft
 *     refusal (cooperative prose, no artifact) runs the §3 chain too.
 *     An explicit refusal with no tool
 *     calls runs the spec §3 fallback chain (fresh contexts, refusal
 *     hygiene: the refused text is never written into the loop's
 *     messages, notes, or events). Telemetry lands in the engagement
 *     audit trail. When every hop refuses, the turn returns an empty
 *     result and the loop's own idle/deliverable machinery decides what
 *     happens next — the refusal itself never becomes context.
 *   - A THROWN content-policy rejection is contained at this call, not
 *     allowed to kill the turn: the failure is logged with its full
 *     provider cause, the call is re-issued once with the verified
 *     engagement record attached and the step context condensed to a
 *     structured summary, and if the re-issue is rejected too the call
 *     routes into the same §3 fallback chain. Non-policy errors keep
 *     their historical behavior and propagate to the caller.
 *
 * Known limitation (spec §4): no per-engagement pseudonym map is built
 * yet, so assembly runs without pseudonymization; the runner's existing
 * PII redaction on tool outputs and evidence still applies.
 */
import {
  assembleCharterMessages,
  assertLocalOnlyRoute,
  classifyResponse,
  complete,
  resolveCharterRoute,
  type AgentRole,
  type CharterEngagement,
  type CharterRole,
  type ChatMessage,
  type ChatResult,
  type FallbackCallImpl,
  type JsonSchemaTool,
  type ResponseFormat,
  type RoleRoute,
} from '@secscan/redteam-llm-router'
import { anchorFor } from './charter-anchor.js'
import { artifactCheckForPhase, isArtifactPhase } from './charter-artifacts.js'
import { type Ctx } from './context.js'
import { callWithPolicyContainment, createFallbackRunner } from './policy-containment.js'
import { type EngagementPhase } from './types.js'

export { condensedReissueMessages } from './policy-containment.js'
export { artifactCheckForPhase, isArtifactPhase, reportArtifactCheck } from './charter-artifacts.js'

/** Which charter seat each agent role sits in (inverse of CHARTER_ROLE_AGENT_ROLE). */
const AGENT_TO_CHARTER: Readonly<Record<AgentRole, CharterRole>> = {
  coordinator: 'coordinator',
  recon: 'recon',
  exploiter: 'exploiter-operator',
  reporter: 'reporter',
  architect: 'coordinator',
}

const engagementCache = new WeakMap<Ctx, CharterEngagement>()

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

/** The per-call options a completion receives (completeForRole's shape). */
export interface CharteredCallOptions {
  tools?: JsonSchemaTool[]
  signal?: AbortSignal
  maxTokens?: number
  temperature?: number
  /** Structured-output constraint for this call (Q-STRUCT A1 seam).
   * Absent = unconstrained, exactly the historical behavior. */
  responseFormat?: ResponseFormat
  /**
   * M6: true when this call must produce an artifact (soft-refusal
   * detection applies in classifyResponse). Absent = derived from the
   * completion's phase via {@link isArtifactPhase} — artifact-producing
   * phases (report/scribe) are artifact tasks, all other phases are
   * not. An explicit value wins over the phase default, so a side call
   * inside an artifact phase (reflection, repair) can opt out.
   */
  artifactTask?: boolean
  /**
   * M6: caller-supplied artifact check for an artifact task — true when
   * the response text IS the artifact in the required format. Absent =
   * {@link artifactCheckForPhase} for artifact phases; without any
   * check, classifyResponse still catches prose-substitute soft
   * refusals on artifact tasks.
   */
  artifactCheck?: (text: string) => boolean
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

/**
 * First line of the filled charter, as assembled by the router's
 * assembleCharterMessages. An array whose head already carries it was
 * chartered by an earlier splice — possibly by a different
 * createCharteredComplete closure — and must never be spliced again.
 */
const CHARTER_HEAD_PREFIX = 'You are an agent of SecScan RedTeam'

/**
 * Whether a message array already carries the assembled charter head.
 *
 * @param messages - the call's messages
 * @returns true when the first message is the assembled charter system text
 */
function isCharterAssembled(messages: ChatMessage[]): boolean {
  const head = messages[0]
  return head?.role === 'system' && head.content.startsWith(CHARTER_HEAD_PREFIX)
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
  // Arrays this closure has already chartered. Side calls (reflector,
  // tool repair) arrive with FRESH arrays that were never spliced, so
  // the old once-per-loop flag left them unchartered; splicing is now
  // per-array, and this set (plus the charter-head check in
  // isCharterAssembled, which survives across closures) keeps it
  // idempotent — an array is never spliced twice.
  const charteredArrays = new WeakSet<ChatMessage[]>()

  return async (role, messages, opts = {}) => {
    const charterRole = AGENT_TO_CHARTER[role]
    if (!route) {
      route = resolveCharterRoute(charterRole)
      assertLocalOnlyRoute(engagement, route)
    }
    const resolvedRoute = route
    if (!charteredArrays.has(messages) && !isCharterAssembled(messages)) {
      const anchor = await anchorFor(ctx, phase, charterRole, engagement, seams)
      const prompt = assembleCharterMessages(engagement, charterRole, messages, { anchor })
      messages.splice(0, messages.length, ...prompt.messages)
      charteredArrays.add(messages)
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
          responseFormat: o.responseFormat,
        }))

    // M6: resolve the REAL artifact flag + check once, here — per-call
    // options win, otherwise the phase this completion was built for
    // decides (isArtifactPhase / artifactCheckForPhase). Hardcoding
    // artifactTask:false made classifyResponse's soft_refusal branch
    // dead for every artifact-producing (report/scribe) call. The pair
    // is shared by the refusal gate below and the §3 fallback chain
    // (forwarded through FallbackRunnerDeps), so hops inside the chain
    // classify with the same artifact expectations as the gate.
    const artifactTask = opts.artifactTask ?? isArtifactPhase(phase)
    const artifactCheck = opts.artifactCheck ?? (artifactTask ? artifactCheckForPhase(phase) : undefined)

    // The spec §3 fallback chain for this call, fed from the call's own
    // messages (policy-containment.ts). Shared by the prose-refusal gate
    // below and the thrown-policy containment: both end here rather
    // than dying.
    const runFallback = createFallbackRunner({
      ctx,
      phase,
      role,
      charterRole,
      engagement,
      messages,
      resolvedRoute,
      artifactTask,
      ...(artifactCheck ? { artifactCheck } : {}),
      fallbackCall: seams.fallbackCall,
      elicitAnchor: () => anchorFor(ctx, phase, charterRole, engagement, seams),
    })

    const contained = await callWithPolicyContainment({
      call,
      route: resolvedRoute,
      messages,
      opts,
      engagement,
      ctx,
      phase,
      role,
      runFallback,
    })
    if (contained.kind === 'fallback') return contained.result
    const result = contained.result
    // Refusal gate: only a tool-less response can be a refusal outcome —
    // a response that acts is an answer, whatever its prose says.
    if (result.toolCalls && result.toolCalls.length > 0) return result
    // The artifact pair resolved at the fallback runner's construction
    // above is reused here: the gate and the chain classify identically.
    const classified = classifyResponse(result, {
      artifactTask,
      ...(artifactCheck ? { artifactCheck } : {}),
    })
    if (classified.refusalClass === 'ok') return result

    ctx.events.append({
      phase,
      actor: 'runner',
      action: 'refusal_detected',
      result: `${role} response classified ${classified.refusalClass} (${classified.reason}) — running the fallback chain; the refused text is excluded from context.`,
    })
    return runFallback()
  }
}
