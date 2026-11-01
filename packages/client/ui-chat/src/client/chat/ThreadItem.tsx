import type { ReactNode } from 'react'
import css from './ThreadItem.module.css'

/**
 * Semantic family of a thread item. The family is the thread's color code:
 * one accent per family, drawn from the shared state/brand aliases, so a
 * reader can tell human input, model speech, executed actions, quiet
 * status, and failures apart at a glance.
 */
export type ThreadFamily =
  | 'user'
  | 'model'
  | 'reasoning'
  | 'command'
  | 'status'
  | 'event'
  | 'retry'
  | 'warning'
  | 'error'

export interface ThreadItemProps {
  /** Color-code family for this item. */
  family: ThreadFamily
  /**
   * Localized type label for the header chip. Omit for rows whose own
   * header already names the type (disclosure rows); the card and accent
   * still apply, so the anatomy stays uniform.
   */
  label?: string | undefined
  /** Header-right metadata (for example a message clock). */
  meta?: ReactNode
  /** Live state: the chip dot pulses while the item is running. */
  running?: boolean | undefined
  children: ReactNode
}

/**
 * The one uniform thread item anatomy: a glass card with a colored left
 * accent, a header row (type chip + optional metadata), and the content
 * area. Every content row in the thread renders inside this card; rows
 * rendered by other packages receive the same card at the Chat flow seam
 * (ChatView.module.css, keyed by the node's flow kind).
 * @param props - family, optional chip label and metadata, and the row body.
 * @returns the card wrapping the row.
 */
export function ThreadItem({ family, label, meta, running, children }: ThreadItemProps): ReactNode {
  return (
    <div className={`${css.card} ${css[family]}`} data-thread-item={family}>
      {label !== undefined && (
        <div className={css.head}>
          <span className={css.chip}>
            <span className={css.dot} data-running={running || undefined} aria-hidden="true" />
            <span className={css.chipLabel}>{label}</span>
          </span>
          {meta !== undefined && <span className={css.meta}>{meta}</span>}
        </div>
      )}
      <div className={css.body}>{children}</div>
    </div>
  )
}
