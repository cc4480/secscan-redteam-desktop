/**
 * Phase-anchor elicitation — split out of charter-completion.ts for the
 * file budget, with no behaviour change. The four marker questions are
 * answered once per phase and cached per Ctx; a failed elicitation is
 * recorded as a missing anchor and never blocks the phase.
 */
import {
  buildPhaseAnchor,
  CHARTER_MARKER_QUESTIONS,
  CHARTER_ROLE_AGENT_ROLE,
  completeWithCharter,
  resolveCharterRoute,
  type CharterEngagement,
  type CharterRole,
  type ChatMessage,
  type RoleRoute,
} from '@secscan/redteam-llm-router'
import { type CharteredCallSeams } from './charter-completion.js'
import { type Ctx } from './context.js'
import { callWithPolicyContainment, createFallbackRunner } from './policy-containment.js'
import { type EngagementPhase } from './types.js'

const anchorCache = new WeakMap<Ctx, Map<string, Promise<string | undefined>>>()

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
    const rawCall =
      seams.elicitationCall ??
      ((eng: CharterEngagement, r: CharterRole, msgs: ChatMessage[]) =>
        completeWithCharter({ engagement: eng, role: r, messages: msgs }))
    // L1: the elicitation call runs under the same thrown-policy
    // containment as every other chartered call in this file
    // (callWithPolicyContainment) — a provider that throws its safety
    // rejection here is re-issued once condensed with the engagement
    // record, then routed into the §3 fallback chain, instead of the
    // rejection landing straight in the catch below as a missing
    // anchor. Non-policy errors still propagate to that catch, exactly
    // as before. The fallback runner's elicitAnchor is a no-op: the
    // anchor is what is being elicited, so it cannot elicit itself.
    const messages: ChatMessage[] = [{ role: 'user', content: prompt }]
    const route = resolveCharterRoute(role)
    const agentRole = CHARTER_ROLE_AGENT_ROLE[role]
    const runFallback = createFallbackRunner({
      ctx,
      phase,
      role: agentRole,
      charterRole: role,
      engagement,
      messages,
      resolvedRoute: route,
      fallbackCall: seams.fallbackCall,
      elicitAnchor: async () => undefined,
    })
    const contained = await callWithPolicyContainment({
      call: async (_route: RoleRoute, msgs: ChatMessage[]) => rawCall(engagement, role, msgs),
      route,
      messages,
      opts: {},
      engagement,
      ctx,
      phase,
      role: agentRole,
      runFallback,
    })
    const res = contained.result
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

export function anchorFor(
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
