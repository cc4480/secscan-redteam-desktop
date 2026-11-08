// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { en } from '../src/client/locales.ts'
import type { ConversationContentProps } from '../src/client/contract/slots.ts'
import { ConversationContent } from '../src/client/skeleton/ConversationContent.tsx'
import {
  dismissLanding, isLandingDismissed, LandingPage, resetLandingDismissalForTests,
} from '../src/client/skeleton/LandingPage.tsx'
import type { LandingPageProps } from '../src/client/skeleton/LandingPage.tsx'

/** jsdom has no ResizeObserver; the composer seat publishes its height through one. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const t = makeTranslate(en, commonEn)

function renderLanding(onEnter = vi.fn()) {
  const renderSlot = (() => null) as LandingPageProps['renderSlot']
  const view = render(<LandingPage t={t} renderSlot={renderSlot} onEnter={onEnter} />)
  return { view, onEnter }
}

describe('LandingPage', () => {
  beforeEach(() => {
    resetLandingDismissalForTests()
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows the approved hero lockup and the live fleet line, nothing invented', () => {
    const { view } = renderLanding()
    expect(view.getByText('SecScan')).toBeTruthy()
    expect(view.getByText('RedTeam')).toBeTruthy()
    expect(view.getByText('Fleet')).toBeTruthy()
    expect(view.getByText('5 agents')).toBeTruthy()
    expect(view.getByText('launch it, watch it work, and read the graded report')).toBeTruthy()
  })

  it('offers one way in: the Enter button, focused so the Enter key works', () => {
    const { view, onEnter } = renderLanding()
    const button = view.getByRole('button', { name: 'Enter' })
    expect(document.activeElement).toBe(button)
    fireEvent.click(button)
    expect(onEnter).toHaveBeenCalledTimes(1)
  })

  it('the page handler ignores Enter when the button itself is focused (its native activation owns the key)', () => {
    const { view, onEnter } = renderLanding()
    const button = view.getByRole('button', { name: 'Enter' })
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(onEnter).not.toHaveBeenCalled()
  })

  it('enters on the Enter key pressed on the page itself', () => {
    const { view, onEnter } = renderLanding()
    const root = view.container.querySelector('[data-landing-page]')
    expect(root).not.toBeNull()
    fireEvent.keyDown(root!, { key: 'Enter' })
    expect(onEnter).toHaveBeenCalledTimes(1)
  })

  it('tracks dismissal for the launch', () => {
    expect(isLandingDismissed()).toBe(false)
    dismissLanding()
    expect(isLandingDismissed()).toBe(true)
    resetLandingDismissalForTests()
    expect(isLandingDismissed()).toBe(false)
  })
})

describe('Landing gate', () => {
  beforeEach(() => {
    resetLandingDismissalForTests()
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  /** Cold-start hero on the main occurrence, stores stubbed to the bone. */
  function renderGate() {
    const props = {
      sessionId: undefined,
      phase: 'hero',
      hero: true,
      variant: 'main',
      useSession: (select: (state: undefined) => unknown) => select(undefined),
      useSessions: (select: (state: { byId: Record<string, never>; ids: never[] }) => unknown) => select({ byId: {}, ids: [] }),
      useSessionStatus: (select: (state: Map<string, never>) => unknown) => select(new Map<string, never>()),
      useWorkspaces: (select: (state: { items: never[]; phase: string }) => unknown) => select({ items: [], phase: 'ready' }),
      useInput: (select: (state: { draft: string }) => unknown) => select({ draft: '' }),
      useComposerBlock: (select: (state: undefined) => unknown) => select(undefined),
      usePinnedCommands: (select: (state: never[]) => unknown) => select([]),
      renderSlot: () => null,
      renderSlotChain: (_key: string, _owner: unknown, options: { fallback?: ReactNode }) => options?.fallback ?? null,
      selectWorkspace: vi.fn(),
      openSession: vi.fn(),
      startNewSession: vi.fn(),
      focusComposer: vi.fn(),
      pinCommand: vi.fn(),
      unpinCommand: vi.fn(),
      inputActions: { setDraft: vi.fn() },
      t,
      useFactorySlot: (_name: string, fallback: (props: never) => ReactNode) => fallback,
    } as unknown as ConversationContentProps
    const view = render(<ConversationContent {...props} />)
    return { view, props }
  }

  it('shows the landing first on the main hero, then home after Enter — and never again', () => {
    const { view, props } = renderGate()
    expect(view.container.querySelector('[data-landing-page]')).not.toBeNull()
    // No composer seat behind the landing.
    expect(view.container.querySelector('[data-composer-seat]')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Enter' }))
    expect(view.container.querySelector('[data-landing-page]')).toBeNull()
    expect(view.container.querySelector('[data-composer-seat]')).not.toBeNull()
    // A remount (the slot unmounting when another panel is selected, then
    // coming back) must not re-show the landing inside this launch.
    view.unmount()
    const again = render(<ConversationContent {...props} />)
    expect(again.container.querySelector('[data-landing-page]')).toBeNull()
    expect(again.container.querySelector('[data-composer-seat]')).not.toBeNull()
  })
})
