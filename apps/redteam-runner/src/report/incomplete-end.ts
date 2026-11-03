/**
 * The mechanical incomplete-end report header — extracted from phase.ts to
 * keep the report phase under the 300-line budget.
 *
 * This is the text used when the seat LLM must NOT run (a halt/block, where
 * re-calling the model could re-hit the same cap and lose the accountability
 * record exactly when it matters most).
 */
import type { Ctx } from '../context.js'

/**
 * Build the HALTED/BLOCKED header for an engagement that did not complete.
 *
 * @param ctx - the engagement context (target, mode, verification proof)
 * @param reason - the halt or block reason
 * @param blocked - true for a blocked end, false for a halt
 * @returns the report markdown header
 */
export function incompleteEndHeader(ctx: Ctx, reason: string, blocked: boolean): string {
  const word = blocked ? 'BLOCKED' : 'HALTED'
  const sentence = blocked
    ? 'could not proceed to completion'
    : 'halted before the reporter phase'
  return (
    `# Engagement report (${word})\n\n` +
    `Target: ${ctx.input.target}\nMode: ${ctx.input.mode}\n` +
    `Status: ${word} — ${reason}\n` +
    `Authorization: ${ctx.verificationProof}\n\n` +
    `This engagement ${sentence}. The findings, coverage, proof bundles, and safety manifest below are the runner-computed record of ` +
    `work completed up to that point — no reporter-agent narrative was generated.\n`
  )
}
