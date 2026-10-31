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
  type ToolCallRequest,
} from '@secscan/redteam-llm-router'
import { createCharteredComplete } from './charter-completion.js'
import { TurnIntegrity, type DeliverableSpec, type RoundCaps } from './turn-integrity.js'
import { Reflector } from './reflector.js'
import { spillToolResult } from './tool-spill.js'
import { inBlackout } from './gate.js'
import { isPrivateOrLoopbackHost } from './prober.js'
import { reconPrompt } from './prompts.js'
import { redactPii } from './safety/index.js'
import { tokenMeterFor } from './harness2/trajectory-normalize.js'
import { stepJournalFor, responseTokens, TOOL_ERROR_PREFIX } from './harness2/steps.js'
import { type EngagementMode, type EngagementPhase, type RulesOfEngagement } from './types.js'
import { type TargetId } from './targets.js'
import { HaltError, type Ctx } from './context.js'
import { sleep } from './util.js'
import { partitionToolCalls, executeToolGroup } from './dispatch/parallel-batch.js'
import { dispatchTool } from './dispatch/router.js'
import { type DispatchResult } from './dispatch/types.js'
import { maybeCompactMessages } from './compaction/compact.js'
import { toolTargetHost } from './dispatch/target-host.js'
import { sharedStateDigest } from './coverage/cells.js'
import { memoryStateFor } from './memory/lifecycle.js'
import { RECON_TOOLS } from './tools.js'

// ---------------------------------------------------------------------------
// Stop-condition plumbing
// ---------------------------------------------------------------------------

async function respectBlackout(ctx: Ctx, phase: EngagementPhase): Promise<void> {
  const w = inBlackout(new Date(), ctx.input.roe.blackoutWindows)
  if (!w) return
  ctx.events.append({
    phase,
    actor: 'runner',
    action: 'blackout_pause',
    result: `Entering blackout window ${w.start}–${w.end}${w.tz ? ` ${w.tz}` : ''}. No traffic until it ends.`,
  })
  for (;;) {
    await sleep(30_000)
    if (!inBlackout(new Date(), ctx.input.roe.blackoutWindows)) break
  }
  ctx.events.append({ phase, actor: 'runner', action: 'blackout_resume', result: 'Blackout window ended. Resuming.' })
}

function haltedByCaps(ctx: Ctx): string | null {
  if (ctx.actions >= ctx.config.maxActions) return `action cap reached (${ctx.config.maxActions})`
  if (Date.now() - ctx.startedAt >= ctx.config.maxDurationMs) return 'duration cap reached'
  if (ctx.consecutive5xx >= 3) return 'three consecutive 5xx responses — possible production impact, halting'
  return null
}

// ---------------------------------------------------------------------------
// The agent loop: REASON → ACT → OBSERVE, bounded
// ---------------------------------------------------------------------------

export type { DeliverableSpec, RoundCaps } from './turn-integrity.js'

/** Default tool-call repair budget per agentLoop invocation (RC Item 6). */
export const DEFAULT_REPAIR_CAP = 3

/**
 * The repair steering for one tagged result: the defect, the tool's
 * schema, and the original arguments, per the Item 6 design. The model
 * answers with exactly one corrected call; the name may change only for
 * an unknown-tool defect, and then only to an offered tool.
 */
function buildRepairPrompt(
  call: ToolCallRequest,
  d: DispatchResult,
  tools: JsonSchemaTool[],
  spent: number,
  cap: number,
): string {
  const defect = d.repairable ?? ''
  const unknownTool = defect.startsWith('unknown tool')
  const lines: string[] = [
    `TOOL-CALL REPAIR (${spent}/${cap}) — a tool call was refused before it executed because the call itself was malformed. ` +
      'This is a call-shape defect, not a policy denial: fix the call and it runs again through every gate.',
    `Tool called: ${call.name}`,
    `Defect: ${defect}`,
    `Original arguments: ${JSON.stringify(call.arguments ?? {})}`,
    `The tool answered: ${d.result}`,
  ]
  if (unknownTool) {
    lines.push('The tool name itself is not one of the offered tools. Answer with the offered tool you actually meant, with corrected arguments.')
    for (const t of tools) lines.push(`Offered tool ${t.name}: ${t.description} Parameters: ${JSON.stringify(t.parameters)}`)
  } else {
    const tool = tools.find(t => t.name === call.name)
    if (tool) lines.push(`Schema for ${tool.name}: ${tool.description} Parameters: ${JSON.stringify(tool.parameters)}`)
    lines.push(`Keep the tool name (${call.name}) — only the arguments may change.`)
  }
  lines.push(
    'Change nothing beyond what the defect requires: same target, same intent. ' +
      'Scope, tier, duplicate, and safety gates all re-run on the corrected call, and a corrected call that trips them is refused for good. ' +
      'Reply with exactly one corrected tool call.',
  )
  return lines.join('\n')
}

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
  // Tool-call repair (RC Item 6): a dispatch result tagged `repairable`
  // (a call-shape defect from the handlers' closed list — never a policy
  // denial) earns its call ONE bounded repair exchange before tallies:
  // a side-channel completion that sees the original call and its result
  // first (API validity), then the steering (defect + schema + original
  // arguments). The corrected call re-runs through dispatchTool — all
  // gates — and on success the corrected result is the effective result
  // the bookkeeping below carries. Every attempt is a `tool_repair`
  // event (model-visible ⟺ logged). The budget is per loop invocation;
  // a repair answer with no tool call closes repair for the rest of the
  // loop — the model, asked to correct its call, declined to.
  const repairCap = opts.repairCap ?? DEFAULT_REPAIR_CAP
  let repairsSpent = 0
  let repairClosed = false
  const attemptRepair = async (call: ToolCallRequest, d: DispatchResult): Promise<DispatchResult> => {
    repairsSpent++
    const defect = d.repairable ?? ''
    const unknownTool = defect.startsWith('unknown tool')
    const logRepair = (outcome: string, detail: string): void => {
      ctx.events.append({
        phase,
        actor: 'runner',
        action: 'tool_repair',
        target: d.target,
        result: `tool_repair (${repairsSpent}/${repairCap}) outcome=${outcome} — ${detail}`,
      })
    }
    let res: ChatResult
    try {
      res = await complete(role, [
        { role: 'system', content: system },
        { role: 'assistant', content: '(tool calls)', toolCalls: [call] },
        { role: 'tool', toolCallId: call.id, content: d.result },
        { role: 'user', content: buildRepairPrompt(call, d, tools, repairsSpent, repairCap) },
      ], { tools })
    } catch (err) {
      logRepair('error', `the repair completion failed: ${(err as Error).message}. Original result stands.`)
      return d
    }
    tokenMeterFor(ctx).record(res.usage)
    const fix = res.toolCalls && res.toolCalls.length > 0 ? res.toolCalls[0] : undefined
    if (!fix) {
      repairClosed = true
      logRepair(
        'no-correction',
        `the repair exchange for ${call.name} returned no tool call (defect: ${defect}); repair is closed for this loop. Original result stands.`,
      )
      return d
    }
    if (!unknownTool && fix.name !== call.name) {
      logRepair(
        'failed',
        `the corrected call names ${fix.name}, not ${call.name} — the tool name may change only for an unknown-tool defect (this defect: ${defect}). Original result stands.`,
      )
      return d
    }
    if (unknownTool && tools.length > 0 && !tools.some(t => t.name === fix.name)) {
      logRepair('failed', `the corrected call names ${fix.name}, which is not one of the offered tools. Original result stands.`)
      return d
    }
    steps.tool(fix.name, JSON.stringify(fix.arguments ?? {}))
    const corrected = await dispatchTool(ctx, role, phase, fix)
    if (corrected.repairable === undefined && !/^(DENIED|HALTED)/i.test(corrected.result)) {
      logRepair('repaired', `${call.name} defect: ${defect}; corrected call ${fix.name} re-dispatched and executed: ${corrected.result.slice(0, 300)}`)
      return corrected
    }
    logRepair('failed', `corrected call ${fix.name} was refused: ${corrected.result.slice(0, 300)}. Original result stands.`)
    return d
  }
  for (let turn = 0; turn < integrity.effectiveMaxTurns; turn++) {
    await respectBlackout(ctx, phase)
    const cap = haltedByCaps(ctx)
    if (cap) {
      ctx.events.append({ phase, actor: 'runner', action: 'halt', result: `Halted: ${cap}.` })
      throw new HaltError(cap)
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
    // The assistant message MUST carry the tool_calls it made: the tool
    // results pushed below are only valid in the API's eyes when preceded by
    // an assistant message containing these calls (ids must match).
    messages.push({ role: 'assistant', content: res.text || '(tool calls)', toolCalls: res.toolCalls })
    // A2: independent target-traffic calls in one response execute in
    // parallel groups (dispatch/parallel-batch.ts). Bookkeeping below
    // still runs per call in the original order, so observations, the
    // event log, and the shared-state digest read as they did when the
    // calls ran one at a time — the digest is computed after its group
    // completes, so it reflects the group's full state.
    // Batch tallies for the reflector: what this turn's tool calls did,
    // counted in the same per-result pass that feeds the wall streak.
    let batchCalls = 0
    let batchSuccesses = 0
    let batchDenied = 0
    for (const group of partitionToolCalls(res.toolCalls, c => toolTargetHost(c), phase === 'recon')) {
      // H2-P1 section-5: the full tool-call arguments, then the full result as
      // the observation (redaction happens inside the journal writer).
      for (const call of group.calls) steps.tool(call.name, JSON.stringify(call.arguments ?? {}))
      const settled = await executeToolGroup(ctx, role, phase, group)
      for (const s of settled) {
        const call = s.call
        if (s.error) {
          steps.observation(call.name, `${TOOL_ERROR_PREFIX}${s.error.message}`)
          throw s.error
        }
        let d = s.d
        // Tool-call repair (RC Item 6): a tagged result earns one repair
        // exchange BEFORE tallies/integrity; the effective result is what
        // the observation, the event log, and the tallies carry.
        if (d.repairable !== undefined && repairCap > 0 && !repairClosed && repairsSpent < repairCap) {
          d = await attemptRepair(call, d)
        }
        steps.observation(call.name, d.result)
        // v0.13.0 safety case: PII is redacted from tool outputs BEFORE they
        // reach the audit log or the agent context. The agents reason about
        // vulnerability shapes, not other people's personal data.
        const safeResult = redactPii(d.result)
        ctx.events.append({
          phase,
          actor: role,
          action: call.name,
          attackId: d.attackId,
          target: d.target,
          result: safeResult.slice(0, 800),
          opsec: d.opsec,
        })
        // Output spill (tool-spill.ts): a result past the observation
        // ceiling is written in full to the engagement's spill dir and the
        // model gets head + omission notice + tail, readable back via
        // read_spill — the ceiling never silently destroys content.
        const spill = spillToolResult({
          dir: ctx.events.dir,
          tool: call.name,
          attackId: d.attackId,
          target: d.target,
          text: safeResult,
        })
        if (spill.record) {
          ctx.events.append({
            phase,
            actor: role,
            action: 'tool_output_spilled',
            attackId: d.attackId,
            target: d.target,
            result: `${call.name}: ${spill.record.chars} chars → ${spill.record.file} (sha256 ${spill.record.sha256.slice(0, 12)})`,
          })
        } else if (spill.failed) {
          ctx.events.append({
            phase,
            actor: role,
            action: 'tool_output_spill_failed',
            attackId: d.attackId,
            target: d.target,
            result: `${call.name}: spill failed (${spill.failed}); observation truncated at the 4000-char ceiling`,
          })
        }
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          // Every observation carries the current shared state — no agent ever
          // works from a stale or private picture (Megazord protocol).
          content: spill.content + '\n' + sharedStateDigest(ctx, phase),
        })
        // Wall detection: consecutive blocked/cooled-down/OPSEC-signaled probes
        // with no successful observation. The coordinator redirects to re-recon.
        const blocked = /^(DENIED|probe failed)/i.test(d.result) || /OPSEC SIGNAL|cooling down/i.test(d.result)
        // Soft-cap progress verdict: one non-blocked, successful result means
        // the round advanced the work; a round of nothing but those is stuck.
        integrity.noteToolResult(!blocked && d.ok !== false)
        batchCalls++
        if (blocked) batchDenied++
        else if (d.ok !== false) batchSuccesses++
        ctx.deniedStreak = blocked ? ctx.deniedStreak + 1 : 0
        const capAfter = haltedByCaps(ctx)
        if (capAfter) {
          ctx.events.append({ phase, actor: 'runner', action: 'halt', result: `Halted: ${capAfter}.` })
          throw new HaltError(capAfter)
        }
      }
    }
    // Reflect before redirecting (reflector.ts): a stuck batch first
    // earns a bounded reflection; the wall redirect is considered only
    // when no reflection was spent on this batch — never both at once.
    const reflection = await reflector.maybeReflect(
      role,
      { calls: batchCalls, successes: batchSuccesses, denied: batchDenied, deniedStreak: ctx.deniedStreak },
      askReflection,
    )
    if (reflection) {
      messages.push({
        role: 'user',
        content: `REFLECTION (${reflection.count}/${reflection.cap}) — verdict: ${reflection.verdict}: ${reflection.steering}`,
      })
    } else if (phase === 'exploit' && ctx.deniedStreak >= 4 && ctx.redirects < 2) {
      ctx.deniedStreak = 0
      ctx.redirects++
      const intel = await commanderRedirect(
        ctx,
        'The exploiter hit a wall: 4+ consecutive probes denied, cooled-down, or OPSEC-signaled with no successful observation.',
      )
      messages.push({ role: 'user', content: intel })
    }
  }
  // Announce a hard-cap stop and state the deliverable's fate, if any —
  // a turn never ends at a limit, or without its deliverable, silently.
  integrity.finalize()
  return notes.join('\n\n')
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

export function promptCtx(ctx: Ctx): {
  mode: EngagementMode
  objective: string
  target: string
  scopeHosts: string[]
  roe: RulesOfEngagement
  fullBattery?: boolean
  targets?: TargetId[]
  localSandbox?: boolean
  memoryBrief?: string
} {
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
    // Q-MEMTIER (§7.1): the recall start pack, when memory was opened
    // and the pack assembled (post-authorize). It reaches the system
    // prompts through memoryBlock and is journaled with them.
    memoryBrief: memoryStateFor(ctx)?.startPack?.text,
  }
}



export /**
 * Commander-ordered focused re-recon. Used when the exploiter hits a wall
 * (mechanical wall detection) or when the coordinator redirects the
 * recon→exploit handoff. Writes to the shared target map as it goes.
 */
async function commanderRedirect(ctx: Ctx, reason: string): Promise<string> {
  ctx.events.append({
    phase: 'exploit',
    actor: 'coordinator',
    action: 'redirect_rerecon',
    result: `Commander redirect (${ctx.redirects}/2): ${reason}`,
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
    RECON_TOOLS,
    6,
  )
  ctx.events.append({ phase: 'recon', actor: 'recon', action: 'rerecon_brief', result: intel.slice(0, 800) })
  return (
    `COMMANDER REDIRECT — re-recon complete (redirect ${ctx.redirects}/2 used). New angles:\n${intel.slice(0, 1200)}\n` +
    `The shared target map now has ${ctx.targetMap.length} entries (see [SHARED STATE]). Form fresh hypotheses from the new angles — do not re-probe cooled-down vectors.`
  )
}
