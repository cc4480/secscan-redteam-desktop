/**
 * The agent driver (v0.19.0 refactor — extracted from phases.ts).
 *
 * agentLoop is the thin REASON → ACT → OBSERVE loop over the model router:
 * promptCtx builds each role's context, extractJsonBlock parses structured
 * model output, and commanderRedirect / blackout / halt plumbing keeps the
 * loop bounded and safe. HaltError is the loop's stop signal.
 */

import {
  ResilienceError,
  describeErrorCause,
  type AgentRole,
  type ChatMessage,
  type ChatResult,
  type JsonSchemaTool,
  type ResponseFormat,
} from '@secscan/redteam-llm-router'
import { createCharteredComplete } from './charter-completion.js'
import { TurnIntegrity, type DeliverableSpec, type RoundCaps } from './turn-integrity.js'
import { Reflector } from './reflector.js'
import { reconPrompt } from './prompts.js'
import { redactPii } from './safety/index.js'
import { tokenMeterFor } from './harness2/trajectory-normalize.js'
import { stepJournalFor, responseTokens } from './harness2/steps.js'
import { type EngagementPhase } from './types.js'
import { HaltError, type Ctx } from './context.js'
import { withBridgeTools } from './dispatch/bridge-gate.js'
import { maybeCompactMessages } from './compaction/compact.js'
import { RECON_TOOLS } from './tools.js'
import { DEFAULT_REPAIR_CAP, budgetExhausted, respectBlackout, safetyHalt } from './agents-budget.js'
import { createRepairExchange, type RepairBudget } from './agents-repair.js'
import { runToolBatch } from './agents-toolbatch.js'
import { promptCtx } from './agents-prompt-ctx.js'

// The public surface of this module is unchanged by the structural split:
// the stop conditions + repair cap live in agents-budget.ts, the repair
// exchange in agents-repair.ts, one turn's tool processing in
// agents-toolbatch.ts, and the phase prompt context in agents-prompt-ctx.ts.
export { DEFAULT_REPAIR_CAP } from './agents-budget.js'
export { promptCtx } from './agents-prompt-ctx.js'

// ---------------------------------------------------------------------------
// The agent loop: REASON → ACT → OBSERVE, bounded
// ---------------------------------------------------------------------------

export type { DeliverableSpec, RoundCaps } from './turn-integrity.js'

export async function agentLoop(
  ctx: Ctx,
  role: AgentRole,
  phase: EngagementPhase,
  system: string,
  user: string,
  tools: JsonSchemaTool[],
  maxTurns: number,
  opts: {
    /** Called when the model stops calling tools. Return a follow-up prompt to
     *  keep the phase going, or null to finish the phase. */
    onIdle?: () => string | null
    /**
     * Progress-aware round caps (ZimZilla port, 2026-10-23). Per-call
     * override of config.softRoundCap / config.hardRoundCap.
     */
    roundCaps?: RoundCaps
    /**
     * Bounded-reflection cap override (reflector.ts, RC Item 7). Wins
     * over config.reflectorCap when set; 0 disables reflection.
     */
    reflectorCap?: number
    /**
     * Structured-output constraint for the loop's own completion calls
     * (Q-STRUCT A3): forwarded to every turn's completion; the chartered
     * seam and the router's capability record decide how each provider
     * honors it. The reflector's verdict call is deliberately NOT
     * constrained (brief §7 — its steering text stays prose). Absent =
     * unconstrained, exactly as before.
     */
    responseFormat?: ResponseFormat
    /**
     * Tool-call repair cap (RC Item 6): the most repair exchanges this
     * loop invocation may spend on `repairable`-tagged dispatch results.
     * Default 3; 0 disables repair. Loop option only — no config field.
     */
    repairCap?: number
    /** When declared, the turn is not finished until this file exists. */
    deliverable?: DeliverableSpec
  } = {},
): Promise<string> {
  // Production completions are chartered (charter-completion.ts): charter
  // first, charter routing, phase anchors, refusal fallback. Tests inject
  // deps.completeForRole and keep the bare seam.
  const complete = ctx.deps.completeForRole ?? createCharteredComplete(ctx, phase)
  // H2-P1 section-5 full-text capture: one steps.jsonl record per prompt, tool
  // call and observation for this engagement (no-op when there is no run dir).
  const steps = stepJournalFor(ctx)
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
  const notes: string[] = []
  // Progress-aware round caps + deliverable contracts (turn-integrity.ts):
  // the soft cap continues a progressing turn and stops only a stuck one,
  // the hard cap is the runaway backstop, and both announce themselves —
  // a capped turn is never indistinguishable from a completed one.
  const integrity = new TurnIntegrity(ctx, phase, maxTurns, opts.roundCaps, opts.deliverable)
  // Bounded reflection (reflector.ts): a stuck batch may spend one
  // metered verdict call on steering before the wall redirect is
  // considered. The reflector keeps its own per-invocation count.
  const reflector = new Reflector(ctx, phase, opts.reflectorCap ?? ctx.config.reflectorCap)
  const askReflection = async (prompt: string): Promise<string> => {
    const res = await complete(role, [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ], { tools: [] })
    tokenMeterFor(ctx).record(res.usage)
    return res.text
  }
  // Tool-call repair (RC Item 6) lives in agents-repair.ts: a `repairable`
  // dispatch result earns ONE bounded repair exchange before tallies, the
  // corrected call re-runs through dispatchTool — all gates — and the budget
  // is per loop invocation. The state object below is what the batch reads
  // and what attemptRepair mutates.
  const repair: RepairBudget = { cap: opts.repairCap ?? DEFAULT_REPAIR_CAP, spent: 0, closed: false }
  const attemptRepair = createRepairExchange({ ctx, role, phase, system, tools, complete, steps, budget: repair })

  for (let turn = 0; turn < integrity.effectiveMaxTurns; turn++) {
    await respectBlackout(ctx, phase)
    // Q-NOHALT: only a safety condition halts. A spent budget closes the loop
    // and lets the phase finish with the work it already has.
    const safety = safetyHalt(ctx)
    if (safety) {
      ctx.events.append({ phase, actor: 'runner', action: 'halt', result: `Halted: ${safety}.` })
      throw new HaltError(safety)
    }
    const spent = budgetExhausted(ctx)
    if (spent) {
      ctx.budgetExhausted = true
      ctx.events.append({ phase, actor: 'runner', action: 'budget_exhausted', result: `Loop closed: ${spent} — keeping completed work; the report records what is still pending.` })
      break
    }
    if (integrity.checkpoint(turn)) break
    // A3 Deep: compact an over-budget history before it is sent, so the
    // steps journal below logs exactly what the model actually saw.
    await maybeCompactMessages(ctx, role, phase, messages, complete, usage => tokenMeterFor(ctx).record(usage))
    let res: ChatResult
    try {
      res = await complete(role, messages, { tools, responseFormat: opts.responseFormat })
    } catch (err) {
      // The outgoing prompt did exist; only the response's tokens are unknown.
      steps.prompt(JSON.stringify(messages), null)
      // Q-HALT Item 1: a ResilienceError's message is only the classifier's
      // rule name — append the classification and the provider cause (the
      // ProviderError on err.cause) so the event, and the trajectory that
      // embeds it verbatim, carry the provider's actual words. The cause
      // segment is redacted: provider bodies can echo request content.
      let result = `LLM call failed: ${(err as Error).message}`
      if (err instanceof ResilienceError) {
        const c = err.classified
        result += ` [classified: ${c.reason}/${c.detail}${c.status !== undefined ? `, HTTP ${c.status}` : ''}]`
      }
      const cause = describeErrorCause(err)
      if (cause !== undefined) result += ` Cause: ${redactPii(cause)}`
      ctx.events.append({ phase, actor: 'runner', action: 'llm_error', result })
      if (err instanceof ResilienceError) {
        // Q-NOHALT: a provider failure is an infrastructure limitation, not a
        // reason to discard the engagement. Mark the fleet down so no further
        // seat burns calls on a dead provider, then close this phase with the
        // work already recorded — the report carries the provider's own words.
        ctx.llmDown = true
        ctx.llmDownReason = result
        ctx.events.append({
          phase,
          actor: 'runner',
          action: 'llm_unavailable',
          result: 'Fleet provider unavailable — closing this phase with the work already recorded and finishing the report mechanically; the engine never halts for a provider outage.',
        })
        break
      }
      throw err
    }
    // Harness2 P1a: the provider's usage is real; accumulate it per engagement.
    tokenMeterFor(ctx).record(res.usage)
    // H2-P1 section-5: the FULL outgoing messages verbatim, plus the token
    // total of the response they produced (per-response tokens).
    steps.prompt(JSON.stringify(messages), responseTokens(res.usage))
    if (res.text || res.reasoning) {
      if (res.text) notes.push(res.text)
      // The thinking trace is first-class observability: it lands in the
      // event feed (and the console) alongside the visible reply.
      // v0.28.0: redact before the audit log — reasoning may echo secrets or
      // PII the upstream input redaction missed.
      const thought = res.reasoning ? `\n[thinking] ${res.reasoning.slice(0, 600)}` : ''
      const reasoningText = redactPii(`${res.text.slice(0, 500)}${thought}`.slice(0, 1200))
      ctx.events.append({ phase, actor: role, action: 'reasoning', result: reasoningText })
    }
    if (!res.toolCalls || res.toolCalls.length === 0) {
      const followUp = opts.onIdle?.()
      if (!followUp) {
        // Deliverable gate: a turn with a declared deliverable is not
        // finished until the file exists. Nudge while nudges remain; the
        // final `deliverable` event after the loop states the outcome.
        const nudge = integrity.deliverableNudge()
        if (nudge) {
          messages.push({ role: 'assistant', content: res.text || '(stopped)' })
          messages.push({ role: 'user', content: nudge })
          continue
        }
        messages.push({ role: 'assistant', content: res.text })
        integrity.markFinished()
        break
      }
      messages.push({ role: 'assistant', content: res.text || '(pausing)' })
      messages.push({ role: 'user', content: followUp })
      ctx.events.append({ phase, actor: 'runner', action: 'phase_nudge', result: followUp.slice(0, 300) })
      continue
    }

    // Process this turn's tool calls (agents-toolbatch.ts): parallel groups,
    // per-result bookkeeping, the repair exchange, observation spill, wall
    // detection, then reflection or the commander redirect — same order as
    // before the split.
    await runToolBatch({
      ctx,
      role,
      phase,
      messages,
      integrity,
      steps,
      reflector,
      text: res.text,
      toolCalls: res.toolCalls,
      repair,
      attemptRepair,
      askReflection,
      commanderRedirect,
    })
  }
  // Announce a hard-cap stop and state the deliverable's fate, if any —
  // a turn never ends at a limit, or without its deliverable, silently.
  integrity.finalize()
  return notes.join('\n\n')
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

export /**
 * Commander-ordered focused re-recon. Used when the exploiter hits a wall
 * (mechanical wall detection) or when the coordinator redirects the
 * recon→exploit handoff. Writes to the shared target map as it goes.
 */
async function commanderRedirect(ctx: Ctx, reason: string, redirectCount?: number): Promise<string> {
  // The count shown is the budget the caller just spent from: the wall
  // counter for a mechanical wall redirect (the default — the wall path
  // is this function's other caller), or the sign-off gate's own count
  // when the coordinator's gate redirect ordered the re-recon (S2-H7).
  const count = redirectCount ?? ctx.wallRedirects
  ctx.events.append({
    phase: 'exploit',
    actor: 'coordinator',
    action: 'redirect_rerecon',
    result: `Commander redirect (${count}/2): ${reason}`,
  })
  const mapLines = ctx.targetMap.map(t => `${t.method} ${t.area}${t.authState ? ` [${t.authState}]` : ''}`).join('; ')
  const intel = await agentLoop(
    ctx,
    'recon',
    'recon',
    reconPrompt(promptCtx(ctx)),
    `COMMANDER REDIRECT — focused re-recon, not a full re-scan. ${reason}\n` +
      `Current shared target map (${ctx.targetMap.length} entries): ${mapLines || '(empty)'}.\n` +
      'Find NEW angles the exploiter has not tried: untested endpoints, parameters, methods, auth flows. ' +
      'Write every discovery to the shared target map with update_target_map as you go. ' +
      'End with a 5-line brief of the new angles.',
    await withBridgeTools(ctx, 'recon', RECON_TOOLS), // Q-BRIDGE-TOOLS gate (bridge-gate.ts)
    6,
  )
  ctx.events.append({ phase: 'recon', actor: 'recon', action: 'rerecon_brief', result: intel.slice(0, 800) })
  return (
    `COMMANDER REDIRECT — re-recon complete (redirect ${count}/2 used). New angles:\n${intel.slice(0, 1200)}\n` +
    `The shared target map now has ${ctx.targetMap.length} entries (see [SHARED STATE]). Form fresh hypotheses from the new angles — do not re-probe cooled-down vectors.`
  )
}
