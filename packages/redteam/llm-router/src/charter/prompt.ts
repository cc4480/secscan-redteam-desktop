/**
 * Charter prompt assembly (spec §2). One assembly path for every chartered
 * call, so the order is a tested fact rather than a convention each caller
 * re-implements: (1) filled charter, (2) role addendum, (3) the agent's
 * generated phase anchor when one is supplied, (4) the exemplar pack for
 * artifact-producing work, (5) any caller system text (persona/theme)
 * appended after the charter, never before it, (6) the SOUL, last on
 * purpose: it is the standing character the fleet works under, and the
 * final position is the recency slot — nothing a caller supplies can push
 * it out of the tail of the system message.
 */

import type { ChatMessage } from '../types.js'
import { buildSystemPrompt, type CharterEngagement, type CharterRole } from './loader.js'
import { sanitizeMessages } from './sanitize.js'
import {
  exemplarPackIncludedByDefault,
  exemplarPackVersion,
  loadExemplarPackText,
} from './exemplars.js'
import { defaultSoulText } from './soul.js'

/** Options for one chartered prompt assembly. */
export interface CharterPromptOptions {
  /** The agent's generated phase anchor (from `buildPhaseAnchor`); carried into the prompt verbatim. */
  anchor?: string
  /** Include the exemplar pack; defaults per role (operator/challenger in, others out). */
  includeExemplars?: boolean
  /** Pack asset text override, for tests and pinned assemblies. */
  exemplarPackText?: string
  /**
   * Per-engagement pseudonym map (spec §4). When supplied, every task
   * message is passed through the sanitizer before assembly — the
   * charter's own filled fields are the caller's responsibility, since
   * the engagement record is where pseudonyms belong when they are
   * needed there. Sanitization fails closed: a surviving secret throws.
   */
  pseudonyms?: Record<string, string>
}

/** A fully assembled chartered prompt plus the facts telemetry needs about it. */
export interface CharterPrompt {
  /** Message list for the provider call: one system message, then the task messages. */
  messages: ChatMessage[]
  /** The exemplar pack version in the prompt, or undefined when the pack was omitted. */
  exemplarPackVersion?: number
  /** True when a phase anchor was carried into the prompt. */
  anchorPresent: boolean
  /**
   * True when the SOUL section closed the system message. Assembly appends
   * the SOUL unconditionally — a missing asset throws in the loader before
   * any prompt exists (no SOUL, no run) — so on a returned prompt this is
   * always true; the fact rides beside `anchorPresent` so the transcript
   * records that the SOUL was in the room for this call.
   */
  soulIncluded: boolean
}

/**
 * Assemble the messages for one chartered call.
 *
 * System messages inside `taskMessages` are caller persona/theme text: they
 * are extracted and appended after the charter block, in their original
 * order — the charter is always first and is never diluted by placement.
 * The SOUL section is appended after the persona texts, as the final
 * section of the system message. All other messages pass through unchanged
 * and in order.
 *
 * @param engagement - the engagement record supplying the charter fields
 * @param role - the agent's charter role
 * @param taskMessages - the task's messages (user/assistant/tool, plus optional persona system text)
 * @param opts - anchor and exemplar-pack options
 * @returns the assembled messages and assembly facts
 * @throws CharterError when the charter cannot be built or the pack is requested but unusable
 */
export function assembleCharterMessages(
  engagement: CharterEngagement,
  role: CharterRole,
  taskMessages: ChatMessage[],
  opts: CharterPromptOptions = {},
): CharterPrompt {
  const sections: string[] = [buildSystemPrompt(engagement, role)]

  let anchorPresent = false
  if (opts.anchor !== undefined && opts.anchor.trim().length > 0) {
    sections.push(`Phase anchor (agent-generated for this phase):\n${opts.anchor.trim()}`)
    anchorPresent = true
  }

  const includeExemplars = opts.includeExemplars ?? exemplarPackIncludedByDefault(role)
  let packVersion: number | undefined
  if (includeExemplars) {
    const packText = opts.exemplarPackText ?? loadExemplarPackText()
    packVersion = exemplarPackVersion(packText)
    sections.push(packText)
  }

  const egressMessages =
    opts.pseudonyms !== undefined ? sanitizeMessages(taskMessages, opts.pseudonyms).messages : taskMessages

  const personaTexts: string[] = []
  const rest: ChatMessage[] = []
  for (const message of egressMessages) {
    if (message.role === 'system') personaTexts.push(message.content)
    else rest.push(message)
  }
  if (personaTexts.length > 0) sections.push(...personaTexts)
  sections.push(defaultSoulText())

  return {
    messages: [{ role: 'system', content: sections.join('\n\n') }, ...rest],
    exemplarPackVersion: packVersion,
    anchorPresent,
    soulIncluded: true,
  }
}
