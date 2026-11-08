/**
 * The home hero's favorites strip: the operator's pinned commands as
 * chips inside the hero panel, under the composer. A chip runs its
 * command through the composer's own input faces (see
 * {@link runHomeCommand}); the New Session chip is the sidebar button's
 * action. Pinning is edited from the commands panel's pin toggles.
 */
import { IconPinFillRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InputActions } from '../contract/input.ts'
import type { ConversationContentProps } from '../contract/slots.ts'
import {
  HOME_COMMANDS_BY_ID, NEW_SESSION_PIN_ID, runHomeCommand,
} from './home-commands.ts'
import css from './HomeFavorites.module.css'

/** The owner's locale seat type, passed to the strip as a plain prop. */
type HomeTranslate = ConversationContentProps['t']

/** Props of the favorites strip. */
export interface HomeFavoritesProps {
  /** The owner's locale seat. */
  t: HomeTranslate
  /** Pinned identities in display order (the inject hooks compartment's snapshot). */
  pinned: readonly string[]
  /** The current Session's input actions; absent without a Session. */
  inputActions: InputActions | undefined
  /** Mirrors the composer's inert posture (no Session, or no workspace picked yet). */
  disabled: boolean
  /** Start a fresh blank Session (the New Session chip). */
  onStartNewSession: () => void
  /** Return keyboard focus to the composer editor after an insert launch. */
  focusComposer: () => void
}

/**
 * Render the favorites strip.
 * @param props - see {@link HomeFavoritesProps}.
 * @returns the strip element.
 */
export function HomeFavorites({
  t, pinned, inputActions, disabled, onStartNewSession, focusComposer,
}: HomeFavoritesProps) {
  return (
    <div className={css.root}>
      <div className={css.head}>
        <span className={css.label}>{t('home.favorites.label')}</span>
        <span className={css.hint}>{t('home.favorites.hint')}</span>
      </div>
      <div className={css.row}>
        {pinned.map((id) => {
          if (id === NEW_SESSION_PIN_ID) {
            return (
              <button
                key={id}
                type="button"
                className={css.chip}
                data-tilt
                onClick={() => { onStartNewSession() }}
              >
                <span className={css.pin}><IconPinFillRegular size={12} /></span>
                {t('home.fav.newSession')}
              </button>
            )
          }
          const command = HOME_COMMANDS_BY_ID.get(id)
          if (command === undefined) return null
          const chipDisabled = disabled || inputActions === undefined
          return (
            <button
              key={id}
              type="button"
              className={css.chip}
              data-tilt
              disabled={chipDisabled}
              onClick={() => {
                if (inputActions !== undefined) runHomeCommand(command, inputActions, focusComposer)
              }}
            >
              <span className={css.pin}><IconPinFillRegular size={12} /></span>
              <span className={css.name}>{command.token}</span>
              {command.id === 'scan' && <span>{t('home.fav.scanArg')}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
