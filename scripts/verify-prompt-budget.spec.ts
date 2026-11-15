/**
 * The prompt-payload budget gate.
 *
 * The gate decides whether the lean profile the tight route returns is within the
 * token budget. Its detection boundary is the comment-header strip, byte counting,
 * and the ceiling comparison, so each of those forms is exercised here.
 */
import { describe, expect, it } from 'vitest'
import {
  BYTES_PER_TOKEN,
  LEAN_PROMPT_BYTE_BUDGET,
  LEAN_PROMPT_TOKEN_BUDGET,
  measurePromptPayloads,
  payloadOf,
  reportPromptBudget,
  toRepositoryPath,
  type PromptPayload,
} from './verify-prompt-budget.ts'

const payload = (bytes: number, file = 'x.md'): PromptPayload => ({
  file,
  bytes,
  tokens: Math.ceil(bytes / BYTES_PER_TOKEN),
})

describe('payloadOf', () => {
  it('strips a leading HTML comment, which the model never reads', () => {
    expect(payloadOf('<!-- maintainer note -->\n\nThe payload.')).toBe('The payload.')
  })

  it('keeps text that has no header', () => {
    expect(payloadOf('Plain payload.')).toBe('Plain payload.')
  })

  it('does not strip a comment that is not at the start', () => {
    expect(payloadOf('Intro.\n<!-- later -->')).toBe('Intro.\n<!-- later -->')
  })
})

describe('toRepositoryPath', () => {
  it('reports one separator form regardless of platform', () => {
    expect(toRepositoryPath('packages\\redteam\\tight.md')).toBe('packages/redteam/tight.md')
    expect(toRepositoryPath('packages/redteam/tight.md')).toBe('packages/redteam/tight.md')
  })
})

describe('reportPromptBudget', () => {
  it('passes a lean payload at the ceiling', () => {
    expect(reportPromptBudget([payload(LEAN_PROMPT_BYTE_BUDGET)]).ok).toBe(true)
  })

  it('fails a lean payload one byte over', () => {
    expect(reportPromptBudget([payload(LEAN_PROMPT_BYTE_BUDGET + 1)]).ok).toBe(false)
  })

  it('measures the ceiling from the token budget', () => {
    expect(LEAN_PROMPT_BYTE_BUDGET).toBe(LEAN_PROMPT_TOKEN_BUDGET * BYTES_PER_TOKEN)
  })

  it('refuses to report when nothing was measured', () => {
    expect(() => reportPromptBudget([])).toThrow(/not measured/)
  })
})

describe('the shipped lean profile', () => {
  it('is measured and inside the budget', () => {
    const measured = measurePromptPayloads(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
    expect(measured.length).toBeGreaterThan(1)
    const lean = measured[0]!
    expect(lean.file).toMatch(/tight\.md$/)
    expect(lean.file).not.toContain('\\')
    expect(reportPromptBudget(measured).ok).toBe(true)
  })
})
