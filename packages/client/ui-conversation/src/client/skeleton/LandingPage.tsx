/**
 * Landing page: the first screen of a launch, in front of home. The
 * approved hero lockup (HeroShell home variant), the live fleet line,
 * and one way in — the Enter control (the Enter key works too).
 * Nothing invented: every word comes from the existing locale seats.
 */
import { useCallback } from 'react'
import type { KeyboardEvent } from 'react'
import type { ConversationContentProps } from '../contract/slots.ts'
import { HeroShell } from './EmptyHero.tsx'
import css from './LandingPage.module.css'

/** The owner's locale seat type, passed down as a plain prop. */
type LandingTranslate = ConversationContentProps['t']

export interface LandingPageProps {
  /** The owner's locale seat, passed down as a plain prop. */
  t: LandingTranslate
  /** Authorized renderer for the hero brand-mark slot. */
  renderSlot: ConversationContentProps['renderSlot']
  /** Called when the owner enters home (button or Enter key). */
  onEnter: () => void
}

// Module-lifetime dismissal: the landing is the first screen of every
// app launch and never reappears inside that launch. The conversation
// slot unmounts when another panel is selected, so component state
// alone would re-show it on the way back; this flag survives the
// unmount and resets with the JS context on the next launch.
let dismissed = false

/** Whether the landing was already dismissed this launch. */
export function isLandingDismissed(): boolean {
  return dismissed
}

/** Dismiss the landing for the rest of this launch. */
export function dismissLanding(): void {
  dismissed = true
}

/** Test-only reset: specs share the module registry within a file. */
export function resetLandingDismissalForTests(): void {
  dismissed = false
}

export function LandingPage({ t, renderSlot, onEnter }: LandingPageProps) {
  // Enter works from anywhere on the page; when the button itself is
  // focused its native activation handles the key, so the root only
  // answers when the key lands on the page itself (no double entry).
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && event.target === event.currentTarget) {
      event.preventDefault()
      onEnter()
    }
  }, [onEnter])
  return (
    <div className={css.root} data-sheen-panel="" data-landing-page="" onKeyDown={onKeyDown}>
      <div className={css.stack}>
        <HeroShell t={t} renderSlot={renderSlot} variant="home" />
        <p className={css.fleetLine}>
          <span className={css.fleetKey}>{t('home.glance.fleet')}</span>
          <span className={css.fleetValue}>{t('home.glance.fleet.value')}</span>
        </p>
        <button type="button" className={css.enter} autoFocus onClick={onEnter}>
          {t('landing.enter')}
        </button>
      </div>
    </div>
  )
}
