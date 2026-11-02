/**
 * The home start state's guide sections, rendered as siblings of the
 * composer seat inside the hero scroll body: Quick start, the
 * Most-used commands panel (with the favorites pin toggles), Continue
 * (real recent Sessions only — the panel is absent when there is
 * nothing to continue), and the side panel (At a glance / The fleet /
 * Guide). Grid placement rides this sheet and the scroll body's home
 * grid (ConversationRoot sheet); the composer seat's parent never
 * changes, so entering a session does not remount the editor.
 */
import type { CSSProperties, ReactNode } from 'react'
import {
  IconChevronUpOutlineRegular, IconNewChatOutlineRegular, IconPinFillRegular, IconPinOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InputActions } from '../contract/input.ts'
import type { ConversationContentProps } from '../contract/slots.ts'
import {
  HOME_COMMAND_GROUPS, runHomeCommand, type HomeCommand,
} from './home-commands.ts'
import css from './HomeSections.module.css'

/** The owner's locale seat type, passed to the sections as a plain prop. */
type HomeTranslate = ConversationContentProps['t']

/** Scroll anchors of the home sections (the side panel's Guide links). */
const QUICK_START_ID = 'home-quick-start'
const COMMANDS_ID = 'home-commands'
const CONTINUE_ID = 'home-continue'

/** The four quick-start steps: locale keys plus the verbatim command token the body highlights. */
const STEPS = [
  { titleKey: 'home.step1.title', bodyKey: 'home.step1.body', token: '/' },
  { titleKey: 'home.step2.title', bodyKey: 'home.step2.body', token: '/scan <target>' },
  { titleKey: 'home.step3.title', bodyKey: 'home.step3.body', token: '/status' },
  { titleKey: 'home.step4.title', bodyKey: 'home.step4.body', token: '/report' },
] as const

/** The fleet seats: names verbatim, roles locale-owned. */
const FLEET_SEATS = [
  { name: 'Morpheus', roleKey: 'home.seat.lead' },
  { name: 'Operator', roleKey: 'home.seat.recon' },
  { name: 'Neo', roleKey: 'home.seat.exploiter' },
  { name: 'Architect', roleKey: 'home.seat.architect' },
  { name: 'Reporter', roleKey: 'home.seat.reporter' },
  { name: 'Scribe', roleKey: 'home.seat.scribe' },
] as const

/**
 * Render copy with one verbatim token highlighted in the mono face.
 * @param text - the translated body, token included.
 * @param token - the exact token substring to highlight.
 * @returns the body with the token wrapped, or the plain text when absent.
 */
function withToken(text: string, token: string): ReactNode {
  const at = text.indexOf(token)
  if (at === -1) return text
  return (
    <>
      {text.slice(0, at)}
      <span className={css.mono}>{token}</span>
      {text.slice(at + token.length)}
    </>
  )
}

/**
 * Scroll one home section into view (the side panel's Guide links).
 * @param id - the section's element id.
 */
function scrollToSection(id: string): void {
  document.getElementById(id)?.scrollIntoView({ block: 'start' })
}

/** Scroll back to the hero panel (the favorites' Guide link). */
function scrollToHero(): void {
  document.querySelector('[data-composer-seat]')?.scrollIntoView({ block: 'start' })
}

/** Props of the home guide sections. */
export interface HomeSectionsProps {
  /** The owner's locale seat. */
  t: HomeTranslate
  /** Selector hook over the Session list (Continue rows derive from it). */
  useSessions: ConversationContentProps['useSessions']
  /** The blank Session the home is staged on; excluded from Continue. */
  currentSessionId: SessionId | undefined
  /** The current Session's input actions; absent without a Session. */
  inputActions: InputActions | undefined
  /** Mirrors the composer's inert posture (no Session, or no workspace picked yet). */
  disabled: boolean
  /** Pinned identities in display order. */
  pinned: readonly string[]
  /** Pin one command identity to the favorites. */
  pinCommand: (id: string) => void
  /** Remove one command identity from the favorites. */
  unpinCommand: (id: string) => void
  /** Open one Session (a Continue row). */
  openSession: (sessionId: SessionId) => void
  /** Return keyboard focus to the composer editor after an insert launch. */
  focusComposer: () => void
}

/**
 * Render the home guide sections and side panel.
 * @param props - see {@link HomeSectionsProps}.
 * @returns the sections fragment (grid items of the hero scroll body).
 */
export function HomeSections({
  t, useSessions, currentSessionId, inputActions, disabled,
  pinned, pinCommand, unpinCommand, openSession, focusComposer,
}: HomeSectionsProps) {
  const ids = useSessions(s => s.ids)
  const byId = useSessions(s => s.byId)
  const recent: SessionSummary[] = []
  for (const id of ids) {
    if (recent.length >= 3) break
    if (id === currentSessionId) continue
    const row = byId[id]
    if (row === undefined || row.blank || row.origin === 'subagent') continue
    recent.push(row)
  }
  const launchDisabled = disabled || inputActions === undefined
  const launch = (command: HomeCommand): void => {
    if (inputActions !== undefined) runHomeCommand(command, inputActions, focusComposer)
  }

  return (
    <>
      <section
        id={QUICK_START_ID}
        className={`${css.panel} ${css.section} ${css.sheen} ${css.rise}`}
        style={{ '--i': 2 } as CSSProperties}
        aria-label={t('home.quickstart.title')}
      >
        <div className={css.panelHead}>
          <h2 className={css.panelTitle}>{t('home.quickstart.title')}</h2>
          <span className={css.panelSub}>{t('home.quickstart.sub')}</span>
          <span className={css.panelTag}>{t('home.guide.title')}</span>
        </div>
        <div className={css.steps}>
          {STEPS.map((step, index) => (
            <div key={step.titleKey} className={css.card}>
              <span className={css.stepN}>{index + 1}</span>
              <h3 className={css.stepTitle}>{t(step.titleKey)}</h3>
              <p className={css.stepBody}>
                {withToken(t(step.bodyKey, { command: step.token }), step.token)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section
        id={COMMANDS_ID}
        className={`${css.panel} ${css.section} ${css.sheen} ${css.rise}`}
        style={{ '--i': 3 } as CSSProperties}
        aria-label={t('home.commands.title')}
      >
        <div className={css.panelHead}>
          <h2 className={css.panelTitle}>{t('home.commands.title')}</h2>
          <span className={css.panelSub}>
            {withToken(t('home.commands.sub', { command: '/' }), '/')}
          </span>
          <span className={css.panelTag}>{t('home.guide.title')}</span>
        </div>
        {HOME_COMMAND_GROUPS.map(group => (
          <div key={group.id}>
            <div className={css.cmdGroup}>{t(group.labelKey)}</div>
            <div className={css.cmdGrid}>
              {group.commands.map((command) => {
                const isPinned = pinned.includes(command.id)
                return (
                  <div key={command.id} className={css.cmd}>
                    <button
                      type="button"
                      className={css.cmdMain}
                      disabled={launchDisabled}
                      onClick={() => { launch(command) }}
                    >
                      <span className={css.cmdName}>
                        {command.token}
                        {command.args !== undefined && (
                          <span className={css.cmdArgs}>{` ${command.args}`}</span>
                        )}
                      </span>
                      <span className={css.cmdDesc}>{t(command.descKey)}</span>
                    </button>
                    <button
                      type="button"
                      className={isPinned ? `${css.starBtn} ${css.starOn}` : css.starBtn}
                      aria-label={t(isPinned ? 'home.pin.unpin' : 'home.pin.pin', { command: command.token })}
                      title={t(isPinned ? 'home.pin.unpin' : 'home.pin.pin', { command: command.token })}
                      onClick={() => {
                        if (isPinned) unpinCommand(command.id)
                        else pinCommand(command.id)
                      }}
                    >
                      {isPinned
                        ? <IconPinFillRegular size={13} />
                        : <IconPinOutlineRegular size={13} />}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </section>

      {recent.length > 0 && (
        <section
          id={CONTINUE_ID}
          className={`${css.panel} ${css.section} ${css.sheen} ${css.rise}`}
          style={{ '--i': 4 } as CSSProperties}
          aria-label={t('home.continue.title')}
        >
          <div className={css.panelHead}>
            <h2 className={css.panelTitle}>{t('home.continue.title')}</h2>
            <span className={css.panelSub}>{t('home.continue.sub')}</span>
          </div>
          <div className={css.contRow}>
            {recent.map(row => (
              <button
                key={row.id}
                type="button"
                className={`${css.card} ${css.cont}`}
                onClick={() => { openSession(row.id) }}
              >
                <span className={css.contMark}>
                  <IconNewChatOutlineRegular size={16} />
                </span>
                <span className={css.contText}>
                  <span className={css.contTitle}>{row.displayTitle}</span>
                  {row.cwd !== undefined && row.cwd !== '' && (
                    <span className={css.contMeta}>{row.cwd}</span>
                  )}
                </span>
                <span className={css.contState}>
                  {t(row.running ? 'home.continue.running' : 'home.continue.session')}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <aside
        className={`${css.panel} ${css.aside} ${css.sheen} ${css.rise}`}
        style={{ '--i': 5 } as CSSProperties}
        aria-label={t('home.glance.title')}
      >
        <section>
          <h3 className={css.sideTitle}>{t('home.glance.title')}</h3>
          <div className={css.kv}>
            <span className={css.k}>{t('home.glance.product')}</span>
            <span className={css.v}>{t('home.glance.product.value')}</span>
          </div>
          <div className={css.kv}>
            <span className={css.k}>{t('home.glance.fleet')}</span>
            <span className={css.v}>{t('home.glance.fleet.value')}</span>
          </div>
          <div className={css.kv}>
            <span className={css.k}>{t('home.glance.grading')}</span>
            <span className={css.v}>{t('home.glance.grading.value')}</span>
          </div>
          <div className={css.kv}>
            <span className={css.k}>{t('home.glance.bridge')}</span>
            <span className={css.v}>{t('home.glance.bridge.value')}</span>
          </div>
          <div className={css.kv}>
            <span className={css.k}>{t('home.glance.reports')}</span>
            <span className={css.v}>{t('home.glance.reports.value')}</span>
          </div>
        </section>
        <section>
          <h3 className={css.sideTitle}>{t('home.fleet.title')}</h3>
          {FLEET_SEATS.map(seat => (
            <div key={seat.name} className={css.seat}>
              <span className={css.seatName}>{seat.name}</span>
              <span className={css.seatRole}>{t(seat.roleKey)}</span>
            </div>
          ))}
        </section>
        <section>
          <h3 className={css.sideTitle}>{t('home.guide.title')}</h3>
          <button
            type="button"
            className={css.guideLink}
            onClick={() => { scrollToSection(QUICK_START_ID) }}
          >
            {t('home.guide.quickstart')}
            <span className={css.guideArrow}><IconChevronUpOutlineRegular size={11} /></span>
          </button>
          <button
            type="button"
            className={css.guideLink}
            onClick={() => { scrollToSection(COMMANDS_ID) }}
          >
            {t('home.guide.commands')}
            <span className={css.guideArrow}><IconChevronUpOutlineRegular size={11} /></span>
          </button>
          <button
            type="button"
            className={css.guideLink}
            onClick={() => { scrollToHero() }}
          >
            {t('home.guide.favorites')}
            <span className={css.guideArrow}><IconChevronUpOutlineRegular size={11} /></span>
          </button>
          {recent.length > 0 && (
            <button
              type="button"
              className={css.guideLink}
              onClick={() => { scrollToSection(CONTINUE_ID) }}
            >
              {t('home.guide.continue')}
              <span className={css.guideArrow}><IconChevronUpOutlineRegular size={11} /></span>
            </button>
          )}
        </section>
        <p className={css.note}>{t('home.note')}</p>
      </aside>
    </>
  )
}
