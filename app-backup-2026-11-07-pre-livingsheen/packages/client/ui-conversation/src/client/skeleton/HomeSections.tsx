/**
 * The home start state's guide area, rendered as siblings of the
 * composer seat inside the hero scroll body: ONE guide panel holding
 * Quick start (four step cards that act — the command steps launch
 * through the same input faces as the command rows, the first step
 * focuses the composer), the Most-used commands (the curated
 * scan-first rows, with the favorites pin toggles), and Continue (the
 * single most recent Session behind one resume button, or an honest
 * empty state when there is nothing to continue) as sub-blocks of the
 * one panel, plus the side panel (At a glance / The fleet / Guide).
 * The sub-blocks keep the sections' element ids, so the side panel's
 * Guide links still scroll to them. Grid placement rides this sheet
 * and the scroll body's home grid (ConversationRoot sheet); the
 * composer seat's parent never changes, so entering a session does
 * not remount the editor.
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
  HOME_COMMANDS_BY_ID, HOME_MOST_USED_COMMANDS, runHomeCommand, type HomeCommand,
} from './home-commands.ts'
import css from './HomeSections.module.css'

/** The owner's locale seat type, passed to the sections as a plain prop. */
type HomeTranslate = ConversationContentProps['t']

/** Scroll anchors of the home sections (the side panel's Guide links). */
const QUICK_START_ID = 'home-quick-start'
const COMMANDS_ID = 'home-commands'
const CONTINUE_ID = 'home-continue'

/** One quick-start step card: its copy, its highlighted token, and how the card acts. */
interface QuickStartStep {
  /** Locale key of the step's title. */
  readonly titleKey: 'home.step1.title' | 'home.step2.title' | 'home.step3.title' | 'home.step4.title'
  /** Locale key of the step's body. */
  readonly bodyKey: 'home.step1.body' | 'home.step2.body' | 'home.step3.body' | 'home.step4.body'
  /** The verbatim command token the body highlights. */
  readonly token: string
  /**
   * The catalog command the card launches; absent on the first step,
   * whose action is focusing the composer (its flow starts there —
   * ask in plain words, or press `/` for the command menu).
   */
  readonly commandId?: string
}

/** The four quick-start steps, in the flow's own order. */
const STEPS: readonly QuickStartStep[] = [
  { titleKey: 'home.step1.title', bodyKey: 'home.step1.body', token: '/' },
  { titleKey: 'home.step2.title', bodyKey: 'home.step2.body', token: '/scan <target>', commandId: 'scan' },
  { titleKey: 'home.step3.title', bodyKey: 'home.step3.body', token: '/status', commandId: 'status' },
  { titleKey: 'home.step4.title', bodyKey: 'home.step4.body', token: '/report', commandId: 'report' },
]

/** The fleet seats: names verbatim, roles locale-owned. */
const FLEET_SEATS = [
  { name: 'Morpheus', roleKey: 'home.seat.lead' },
  { name: 'Tank', roleKey: 'home.seat.recon' },
  { name: 'Neo', roleKey: 'home.seat.exploiter' },
  { name: 'Agent Smith', roleKey: 'home.seat.architect' },
  { name: 'Trinity', roleKey: 'home.seat.reporter' },
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
  /** Selector hook over the Session list (the Continue resume derives from it). */
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
  /** Open one Session (the Continue resume button). */
  openSession: (sessionId: SessionId) => void
  /** Return keyboard focus to the composer editor after an insert launch. */
  focusComposer: () => void
}

/**
 * Render the home guide panel and side panel.
 * @param props - see {@link HomeSectionsProps}.
 * @returns the panels fragment (grid items of the hero scroll body).
 */
export function HomeSections({
  t, useSessions, currentSessionId, inputActions, disabled,
  pinned, pinCommand, unpinCommand, openSession, focusComposer,
}: HomeSectionsProps) {
  const ids = useSessions(s => s.ids)
  const byId = useSessions(s => s.byId)
  // The one session Continue resumes: the first listed row that is not
  // the staged blank, a blank row, or a subagent row — the list's own
  // order is the recency order the sidebar shows.
  const resume: SessionSummary | undefined = ids
    .filter(id => id !== currentSessionId)
    .map(id => byId[id])
    .find(row => row !== undefined && !row.blank && row.origin !== 'subagent')
  const launchDisabled = disabled || inputActions === undefined
  const launch = (command: HomeCommand): void => {
    if (inputActions !== undefined) runHomeCommand(command, inputActions, focusComposer)
  }

  return (
    <>
      <section
        className={`${css.panel} ${css.section} ${css.sheen} ${css.rise}`}
        style={{ '--i': 2 } as CSSProperties}
        aria-label={t('home.guide.title')}
      >
        <div className={css.guideBlocks}>
          <div
            id={QUICK_START_ID}
            className={css.guideBlock}
            aria-label={t('home.quickstart.title')}
          >
            <div className={css.panelHead}>
              <h2 className={css.panelTitle}>{t('home.quickstart.title')}</h2>
              <span className={css.panelSub}>{t('home.quickstart.sub')}</span>
            </div>
            <div className={css.steps}>
          {STEPS.map((step, index) => {
            const command = step.commandId === undefined
              ? undefined
              : HOME_COMMANDS_BY_ID.get(step.commandId)
            return (
              <button
                key={step.titleKey}
                type="button"
                className={css.card}
                disabled={command !== undefined && launchDisabled}
                onClick={() => {
                  if (command === undefined) focusComposer()
                  else launch(command)
                }}
              >
                <span className={css.stepN}>{index + 1}</span>
                <span className={css.stepTitle}>{t(step.titleKey)}</span>
                <span className={css.stepBody}>
                  {withToken(t(step.bodyKey, { command: step.token }), step.token)}
                </span>
              </button>
            )
          })}
            </div>
          </div>

          <div
            id={COMMANDS_ID}
            className={css.guideBlock}
            aria-label={t('home.commands.title')}
          >
            <div className={css.panelHead}>
              <h2 className={css.panelTitle}>{t('home.commands.title')}</h2>
              <span className={css.panelSub}>
                {withToken(t('home.commands.sub', { command: '/' }), '/')}
              </span>
            </div>
            <div className={css.cmdGrid}>
          {HOME_MOST_USED_COMMANDS.map(({ command, kindKey }) => {
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
                  <span className={css.cmdKind}>{t(kindKey)}</span>
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

          <div
            id={CONTINUE_ID}
            className={css.guideBlock}
            aria-label={t('home.continue.title')}
          >
            <div className={css.panelHead}>
              <h2 className={css.panelTitle}>{t('home.continue.title')}</h2>
              <span className={css.panelSub}>{t('home.continue.sub')}</span>
            </div>
        {resume === undefined ? (
          <p className={css.contEmpty}>{t('home.continue.empty')}</p>
        ) : (
          <div className={css.contRow}>
            <button
              type="button"
              className={`${css.card} ${css.cont}`}
              onClick={() => { openSession(resume.id) }}
            >
              <span className={css.contMark}>
                <IconNewChatOutlineRegular size={16} />
              </span>
              <span className={css.contText}>
                <span className={css.contTitle}>{resume.displayTitle}</span>
                {resume.cwd !== undefined && resume.cwd !== '' && (
                  <span className={css.contMeta}>{resume.cwd}</span>
                )}
              </span>
              <span className={css.contState}>
                {t(resume.running ? 'home.continue.running' : 'home.continue.session')}
              </span>
              <span className={css.contResume}>{t('home.continue.resume')}</span>
            </button>
          </div>
        )}
          </div>
        </div>
      </section>

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
          <button
            type="button"
            className={css.guideLink}
            onClick={() => { scrollToSection(CONTINUE_ID) }}
          >
            {t('home.guide.continue')}
            <span className={css.guideArrow}><IconChevronUpOutlineRegular size={11} /></span>
          </button>
        </section>
        <p className={css.note}>{t('home.note')}</p>
      </aside>
    </>
  )
}
