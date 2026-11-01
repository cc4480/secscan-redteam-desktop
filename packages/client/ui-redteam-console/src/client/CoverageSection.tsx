/**
 * The coverage section: the battery cells, the item-verdict rollup, and
 * the pending keys — the console's own coverage accounting for the
 * engagement, verbatim.
 */
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'
import type { Coverage } from './engagements-model.ts'
import type { SectionState } from './panel-store.ts'
import css from './EngagementsPage.module.css'

/** The battery cells in order: field, label key. */
const CELLS = [
  { field: 'logic', label: 'coverage.cell.logic' },
  { field: 'functionality', label: 'coverage.cell.functionality' },
  { field: 'validation', label: 'coverage.cell.validation' },
] as const

/**
 * The coverage section.
 * @param props - the section state and copy.
 * @returns cells, disposition rollup, and pending keys.
 */
export function CoverageSection({ section, t }: {
  section: SectionState<Coverage> | undefined
  t: TranslateNS<'redteamConsole'>
}): ReactNode {
  if (section === undefined || section.kind === 'loading') {
    return <p className={css.note}>{t('section.loading')}</p>
  }
  if (section.kind === 'failed') {
    return <p className={css.errorLine}>{t('section.failed', { message: section.message })}</p>
  }
  const coverage = section.value
  const cells = coverage.cells
  if (cells === null && coverage.total === 0) {
    return <p className={css.note}>{t('coverage.none')}</p>
  }
  return (
    <div>
      {cells !== null && (
        <>
          <h4 className={css.subTitle}>{t('coverage.cells')}</h4>
          <div className={css.cellRow}>
            {CELLS.map(cell => (
              <span
                key={cell.field}
                className={clsx(css.cellChip, cells[cell.field] === 1 ? css.cellOn : css.cellOff)}
              >
                {`${t(cell.label)} · ${cells[cell.field] === 1 ? t('coverage.covered') : t('coverage.notCovered')}`}
              </span>
            ))}
          </div>
        </>
      )}
      <dl className={css.kv}>
        <div className={css.kvRow}>
          <dt>{t('coverage.total')}</dt>
          <dd>{coverage.total}</dd>
        </div>
        {Object.entries(coverage.byDisposition).map(([name, count]) => (
          <div key={name} className={css.kvRow}>
            <dt>{name}</dt>
            <dd>{count}</dd>
          </div>
        ))}
      </dl>
      {coverage.pending.length > 0 && (
        <>
          <h4 className={css.subTitle}>{`${t('coverage.pending')} (${coverage.pendingTotal})`}</h4>
          <ul className={css.pendingList}>
            {coverage.pending.map(key => <li key={key}>{key}</li>)}
          </ul>
        </>
      )}
    </div>
  )
}
