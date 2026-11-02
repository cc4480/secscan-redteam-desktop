// The composer remains in ConversationRoot so switching out of the blank-draft
// phase does not remount its textarea.

import type { ReactNode, RefObject } from 'react'
import {
  DiamondLogo, IconChevronDownOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { workspaceTitleOf } from '@deepseek-ai/dsh-util-workspace-path'
import type { ConversationContentProps } from '../contract/slots.ts'
import css from './HeroShell.module.css'

/** The owner's locale seat type, passed to hero chrome as a plain prop. */
type HeroTranslate = ConversationContentProps['t']

/**
 * Basename label for the workspace chip (the shared derivation);
 * separator-only paths echo the raw cwd.
 * @param cwd - workspace directory path (non-empty).
 * @returns chip label.
 */
export function workspaceLabel(cwd: string): string {
  const base = workspaceTitleOf(cwd)
  return base !== '' ? base : cwd
}

/**
 * The workspace chip (folder + label + chevron), always interactive: before
 * the first message the workspace stays switchable — picking another one
 * moves the New Session flow to that workspace's blank session. Without a
 * label the chip renders its placeholder state: closed folder + the
 * "Choose workspace" call to action.
 * @param props.label - chip label (see {@link workspaceLabel}); omitted → placeholder.
 * @param props.menuOpen - menu expansion echo.
 * @param props.onClick - menu toggle.
 * @returns the chip button element.
 */
export function WorkspaceChip({ buttonRef, label, menuOpen = false, onClick, t }: {
  buttonRef?: RefObject<HTMLButtonElement>
  label?: string | undefined
  menuOpen?: boolean
  onClick?: () => void
  t: HeroTranslate
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={css.workspace}
      aria-label={t('hero.chooseWorkspace')}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onClick={onClick}
    >
      {label === undefined
        ? <IconFolderCloseRegular className={css.folder} size={16} />
        : <IconFolderOpenRegular className={css.folder} size={16} />}
      <span className={css.workspaceLabel}>{label ?? t('hero.chooseWorkspace')}</span>
      <IconChevronDownOutlineRegular className={css.chevron} size={12} />
    </button>
  )
}

/** Hero chrome props. The workspace row rides the InputBar accessory hole, not here. */
export interface HeroShellProps {
  /** The owner's locale seat, passed down as a plain prop. */
  t: HeroTranslate
  /** Authorized renderer for the hero brand-mark slot. */
  renderSlot: ConversationContentProps['renderSlot']
  /**
   * `home` (default): the home start-state header — hero-scale mark,
   * wordmark, tagline. `compact`: the centered headline form embedded
   * occurrences (the subagent sidebar chat) keep.
   */
  variant?: 'home' | 'compact'
  /** Overlay content after the stack (modals). */
  children?: ReactNode
}

/**
 * The hero fallback mark: the SecScan RedTeam diamond in its official
 * fixed fills. A registered occupant of the hero brand slot renders
 * the same diamond; the fallback exists so a build without a brand
 * package still shows the product mark. The diamond always holds
 * still — no hover animation rides it.
 * @param props.size - square edge in pixels (96 home, 34 compact).
 * @returns the mark svg element.
 */
function HeroDiamond({ size }: { size: number }) {
  return <DiamondLogo size={size} className={css.mark} />
}

/**
 * Render the hero header. The home variant is the home start state's
 * top block: the product mark at hero scale, the SecScan RedTeam
 * wordmark (the tail in the mark's diamond red), and the tagline. The
 * composer, workspace row, and favorites live in the composer stack
 * around this header — every action on the home starts a session
 * immediately; nothing here gates. The compact variant keeps the
 * centered headline form for embedded occurrences.
 * @param props - see {@link HeroShellProps}.
 * @returns the hero header element tree.
 */
export function HeroShell({ t, renderSlot, variant = 'home', children }: HeroShellProps) {
  if (variant === 'compact') {
    return (
      <div className={`${css.root} ${css.compact}`}>
        <div className={css.stack}>
          <div className={css.headline}>
            {/* The 34px diamond leading the headline, gap 10. */}
            <span className={css.fishHitbox}>
              {renderSlot('conversation.hero.brand.mark', { size: 34, className: css.mark }, {
                fallback: <HeroDiamond size={34} />,
              })}
            </span>
            <span className={css.titleGroup}>
              {/* Own element: keeps the headline text addressable apart from the badge. */}
              <span>{t('hero.headline')}</span>
              <span className={css.previewBadge}>{t('hero.preview')}</span>
            </span>
          </div>
          <div className={css.body}>
            {/* The composer remains mounted outside this component. */}
          </div>
        </div>
        {children}
      </div>
    )
  }
  return (
    <div className={`${css.root} ${css.home}`}>
      <div className={css.stack}>
        <div className={css.headline}>
          {/* The 96px mark: the full desktop icon artwork in its tile. */}
          <span className={css.markSeat}>
            {renderSlot('conversation.hero.brand.mark', { size: 96, className: css.mark }, {
              fallback: <HeroDiamond size={96} />,
            })}
          </span>
          <div className={css.wordGroup}>
            <div className={css.wordmark}>
              <span>{t('home.wordmark.lead')}</span>
              {' '}
              <span className={css.wordmarkTail}>{t('home.wordmark.tail')}</span>
            </div>
            <p className={css.tagline}>
              {t('home.tagline.lead')}
              <b>{t('home.tagline.strong')}</b>
              {t('home.tagline.tail')}
            </p>
          </div>
        </div>
        <div className={css.body}>
          {/* The composer remains mounted outside this component. */}
        </div>
      </div>
      {children}
    </div>
  )
}
