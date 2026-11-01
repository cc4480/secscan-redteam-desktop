// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { TurnUsagePanel } from '../src/client/chat/TurnUsagePanel.tsx'
import type { TurnTokenUsage } from '../src/client/contract/chat-nodes.ts'
import { en } from '../src/client/locale.ts'

const t = makeTranslate(en, commonEn)

afterEach(cleanup)

describe('TurnUsagePanel', () => {
  it('shows an icon-and-total pill and opens the usage dialog on click', () => {
    const usage: TurnTokenUsage = {
      uncachedInputTokens: 5_060,
      cacheReadTokens: 4_940,
      cacheWriteTokens: 0,
      outputTokens: 5_800,
      reasoningTokens: 42,
      totalTokens: 15_800,
      routes: [{ provider: 'deepseek', model: 'deepseek-chat' }],
    }
    const view = render(<TurnUsagePanel usage={usage} t={t} />)

    const trigger = view.getByRole('button')
    // Split headline: 10.9K fresh (5,060 uncached + 5,800 output) + 4.9K cached.
    expect(trigger.textContent).toBe('Usage 10.9K tok + 4.9K cached')
    expect(trigger.querySelector('svg')).not.toBeNull()
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(view.queryByRole('dialog')).toBeNull()

    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const dialog = view.getByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('Turn usage')
    // Portaled out of the trigger's row, with a heading row carrying the total.
    expect(dialog.parentElement).toBe(document.body)
    expect(dialog.firstChild?.textContent).toBe('Turn usage15,800 tok')
    const details = dialog.querySelector('[data-turn-usage-details]') as HTMLElement
    expect(details).toBeTruthy()
    expect(details.textContent).toContain('Provider / modeldeepseek/deepseek-chat')
    expect(details.textContent).toContain('Cache hit49.4%')
    expect(details.textContent).toContain('Uncached input5,060 tok')
    expect(details.textContent).toContain('Cached input4,940 tok')
    expect(details.textContent).toContain('Cache write0 tok')
    expect(details.textContent).toContain('Output5,800 tok (42 tok reasoning)')
    expect(details.textContent).not.toContain('Total')
    // The deepseek route declares no rate in the pricing table: no dollar figure.
    expect(details.textContent).not.toContain('Estimated cost')
  })

  it('omits unavailable optional facts instead of inventing values', () => {
    const usage: TurnTokenUsage = {
      uncachedInputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
    }
    const view = render(<TurnUsagePanel usage={usage} t={t} />)

    const trigger = view.getByRole('button')
    expect(trigger.textContent).toBe('Usage 150 tok')
    fireEvent.click(trigger)
    expect(view.queryByText('Provider / model')).toBeNull()
    expect(view.queryByText('Cache hit')).toBeNull()
    expect(view.queryByText('Cached input')).toBeNull()
    expect(view.queryByText('Cache write')).toBeNull()
    expect(view.queryByText(/reasoning/)).toBeNull()
  })

  it('keeps a partial cache hit below 100 in the dialog and closes on Escape or outside pointerdown', () => {
    const usage: TurnTokenUsage = {
      uncachedInputTokens: 1,
      cacheReadTokens: 999,
      outputTokens: 100,
      totalTokens: 1_100,
    }
    const view = render(<TurnUsagePanel usage={usage} t={t} />)
    const trigger = view.getByRole('button')
    // The pill carries the compact split (101 fresh + 999 cached); cache-hit
    // rate and exact token counts stay in the dialog.
    expect(trigger.textContent).toBe('Usage 101 tok + 999 cached')

    fireEvent.click(trigger)
    const dialog = view.getByRole('dialog')
    expect(dialog.textContent).toContain('Cache hit99.9%')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('dialog')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(trigger)
    // A pointerdown inside the panel keeps it open; one outside closes it.
    fireEvent.pointerDown(view.getByRole('dialog'))
    expect(view.queryByRole('dialog')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('shows an estimated cost in the dialog when the route declares a rate', () => {
    const usage: TurnTokenUsage = {
      uncachedInputTokens: 2_000_000,
      cacheReadTokens: 2_000_000,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000,
      totalTokens: 5_000_000,
      routes: [{ provider: 'meta', model: 'muse-spark-1.3' }],
    }
    const view = render(<TurnUsagePanel usage={usage} t={t} />)
    const trigger = view.getByRole('button')
    expect(trigger.textContent).toBe('Usage 3M tok + 2M cached')
    fireEvent.click(trigger)
    const details = view.getByRole('dialog').querySelector('[data-turn-usage-details]') as HTMLElement
    // 2M x $1.25 + 2M x $0.15 + 1M x $4.25 = $7.05 at the declared spark rates.
    expect(details.textContent).toContain('Estimated cost$7.05')
  })

  it('shows the split without a dollar figure for a seat with no declared rate', () => {
    const usage: TurnTokenUsage = {
      uncachedInputTokens: 2_000_000,
      cacheReadTokens: 2_000_000,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000,
      totalTokens: 5_000_000,
      routes: [{ provider: 'meta', model: 'muse-spark-1.1' }],
    }
    const view = render(<TurnUsagePanel usage={usage} t={t} />)
    expect(view.getByRole('button').textContent).toBe('Usage 3M tok + 2M cached')
    fireEvent.click(view.getByRole('button'))
    const details = view.getByRole('dialog').querySelector('[data-turn-usage-details]') as HTMLElement
    // muse-spark-1.1 is registered with no price line: never invent one.
    expect(details.textContent).not.toContain('Estimated cost')
    expect(details.textContent).not.toContain('$')
  })
})
