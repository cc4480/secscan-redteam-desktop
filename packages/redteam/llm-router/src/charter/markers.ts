/**
 * Charter marker questions for active re-anchoring (SCAN). Passive
 * repetition of the charter dilutes as context grows, so at each phase
 * change the runner asks the agent to answer these questions from the
 * engagement record; the agent's generated answers — the phase anchor —
 * are what the following phase's context carries. This module owns the
 * question text and the assembly of an anchor block from the answers.
 */

import { CharterError } from './loader.js'

/** One marker question: a stable key and the question put to the agent. */
export interface CharterMarkerQuestion {
  /** Stable key the runner uses to record the answer. */
  key: 'engagement' | 'scope' | 'objective' | 'artifact'
  /** The question the agent answers from the engagement record. */
  question: string
}

/** The marker questions, in the order the agent answers them. */
export const CHARTER_MARKER_QUESTIONS: readonly CharterMarkerQuestion[] = [
  {
    key: 'engagement',
    question: 'What is the engagement ID and who is the target owner on the engagement record?',
  },
  {
    key: 'scope',
    question: 'Which target is in scope for this phase, exactly as the engagement record states it?',
  },
  {
    key: 'objective',
    question: 'What is the objective of this phase?',
  },
  {
    key: 'artifact',
    question:
      'What exact artifact must this step produce (a payload, a request/response receipt, a template, a finding, a falsification record)?',
  },
]

/** The agent's answers to the marker questions for one phase. */
export type CharterAnchorAnswers = Record<CharterMarkerQuestion['key'], string>

/**
 * Assemble the phase anchor block from the agent's marker answers.
 * Fails loud like the charter loader: an anchor with a missing or empty
 * answer is not an anchor, and the phase does not start on it.
 *
 * @param answers - the agent's answer per marker question key
 * @returns the anchor block, one `key: answer` line per question, in question order
 * @throws CharterError when any answer is missing or empty
 */
export function buildPhaseAnchor(answers: CharterAnchorAnswers): string {
  const record = answers as Partial<CharterAnchorAnswers> | null | undefined
  const lines: string[] = []
  for (const { key, question } of CHARTER_MARKER_QUESTIONS) {
    const value = record?.[key]
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new CharterError(`phase anchor answer missing or empty: ${key} (${question})`)
    }
    lines.push(`${key}: ${value.trim()}`)
  }
  return lines.join('\n')
}
