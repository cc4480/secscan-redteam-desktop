/**
 * runToolBatch — one turn's tool-call processing.
 *
 * Extracted from agents.ts in a structural split (no file under src/ may
 * exceed 300 lines). The block is the original straight-line tail of the
 * loop body, moved verbatim and keeping its order: push the assistant
 * message carrying the tool_calls, partition the calls into sequential /
 * parallel groups, per result run the repair exchange, redact and log the
 * event, spill oversized output, push the observation with the current
 * shared-state digest, count the tallies and the denied streak, re-check
 * the safety halt, then reflect or (in exploit) commander-redirect. Only
 * the call/response locals are threaded in as deps; no condition, event
 * action string, or ordering changed.
 */

import {
  type AgentRole,
  type ChatMessage,
  type ToolCallRequest,
} from '@secscan/redteam-llm-router'
import { HaltError, type Ctx } from './context.js'
import { type EngagementPhase } from './types.js'
import { type StepJournal, TOOL_ERROR_PREFIX } from './harness2/steps.js'
import { type TurnIntegrity } from './turn-integrity.js'
import { type Reflector } from './reflector.js'
import { partitionToolCalls, executeToolGroup } from './dispatch/parallel-batch.js'
import { toolTargetHost } from './dispatch/target-host.js'
import { redactPii } from './safety/index.js'
import { spillToolResult } from './tool-spill.js'
import { sharedStateDigest } from './coverage/cells.js'
import { safetyHalt } from './agents-budget.js'
import { type RepairAttempt, type RepairBudget } from './agents-repair.js'

export interface ToolBatchDeps {
  ctx: Ctx
  role: AgentRole
  phase: EngagementPhase
  messages: ChatMessage[]
  integrity: TurnIntegrity
  steps: StepJournal
  reflector: Reflector
  /** The response text (the assistant message content). */
  text: string
  /** This response's non-empty tool calls. */
  toolCalls: ToolCallRequest[]
  repair: RepairBudget
  attemptRepair: RepairAttempt
  askReflection: (prompt: string) => Promise<string>
  commanderRedirect: (ctx: Ctx, reason: string) => Promise<string>
}

export async function runToolBatch(deps: ToolBatchDeps): Promise<void> {
  const {
    ctx, role, phase, messages, integrity, steps, reflector,
    text, toolCalls, repair, attemptRepair, askReflection, commanderRedirect,
  } = deps
    // The assistant message MUST carry the tool_calls it made: the tool
    // results pushed below are only valid in the API's eyes when preceded by
    // an assistant message containing these calls (ids must match).
    messages.push({ role: 'assistant', content: text || '(tool calls)', toolCalls })
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
    for (const group of partitionToolCalls(toolCalls, c => toolTargetHost(c), phase === 'recon')) {
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
        if (d.repairable !== undefined && repair.cap > 0 && !repair.closed && repair.spent < repair.cap) {
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
        const capAfter = safetyHalt(ctx)
        if (capAfter) {
          ctx.events.append({ phase, actor: 'runner', action: 'halt', result: `Halted: ${capAfter}.` })
          throw new HaltError(capAfter)
        }
        // Q-NOHALT: a spent budget does NOT abort the batch mid-flight — the
        // remaining calls in this batch were already dispatched and their work
        // is real (item verdicts, recorded observations). The loop-top check
        // stops the next turn, so nothing is lost and nothing overruns.
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
